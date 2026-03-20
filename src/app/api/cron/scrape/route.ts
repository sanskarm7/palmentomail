import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { emails, mailPieces, appConfig, users } from "@/db/schema";
import {
  getGmailClient,
  listDigestMessages,
  getMessageHtml,
  getImageByCid,
} from "@/lib/gmail";
import { parseInformedDeliveryTiles } from "@/lib/parser";
import { runOcr } from "@/lib/ocr";
import { interpretMailWithGemini, interpretMailWithGeminiVision, resetLlmCallCount } from "@/lib/llm";
import { createHash } from "crypto";
import { eq, and } from "drizzle-orm";
import { supabase } from "@/lib/supabase";
import { google } from "googleapis";

export const maxDuration = 60;

const DEFAULT_QUERY =
  'from:USPSInformeddelivery@email.informeddelivery.usps.com subject:"Daily Digest" newer_than:3d';

export async function GET(request: Request) {
  // Validate secure CRON invocation
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized cron trigger" }, { status: 401 });
  }

  try {
    // 1. Fetch the master refresh token from Supabase
    const tokenRecord = await db
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(eq(appConfig.id, "google_refresh_token"))
      .limit(1);

    if (tokenRecord.length === 0 || !tokenRecord[0].value) {
      return NextResponse.json({ error: "No root refresh token found in database" }, { status: 400 });
    }

    const refreshToken = tokenRecord[0].value;

    // 2. Fetch the master User ID to associate the mail against 
    const userRecord = await db.select({ id: users.id }).from(users).limit(1);
    if (userRecord.length === 0) {
      return NextResponse.json({ error: "No primary user account found" }, { status: 400 });
    }
    const userId = userRecord[0].id;

    // 3. Generate a fresh temporary Google Access Token
    const oauth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await oauth.refreshAccessToken();

    if (!credentials.access_token) {
      return NextResponse.json({ error: "Failed to rotate access token" }, { status: 500 });
    }

    const accessToken = credentials.access_token;
    const gmail = getGmailClient(accessToken);
    const query = process.env.GMAIL_QUERY || DEFAULT_QUERY;

    console.log("[CRON] Searching master Gmail...");
    const allMessages = await listDigestMessages(gmail, query);
    const maxMessages = parseInt(process.env.GMAIL_MAX_MESSAGES ?? "5", 10);
    const list = allMessages.slice(0, isNaN(maxMessages) ? 5 : maxMessages);
    
    console.log(`[CRON] Found ${allMessages.length} messages. Processing max ${list.length}.`);

    resetLlmCallCount();
    let inserted = 0;

    // 4. Run the core ingestion pipeline
    for (const [index, msg] of list.entries()) {
      const msgId = msg.id;
      if (!msgId) continue;

      const existingEmail = await db
        .select({ id: emails.id })
        .from(emails)
        .where(and(eq(emails.id, msgId), eq(emails.userId, userId)))
        .limit(1);

      if (existingEmail.length > 0) {
        console.log(`[CRON] → Skipped duplicate email (${msgId})`);
        continue;
      }

      console.log(`[CRON] Downloading HTML for email (${msgId})...`);
      const html = await getMessageHtml(gmail, msgId);
      if (!html) continue;

      const tiles = parseInformedDeliveryTiles(html);
      console.log(`[CRON] → Found ${tiles.length} mail piece(s) inside.`);

      const emailDeliveryDate = tiles[0]?.deliveryDate || "";

      try {
        await db.insert(emails).values({
          id: msgId,
          userId,
          deliveryDate: emailDeliveryDate,
        });
      } catch (err: any) {
        console.log(`[CRON] → Failed to log email to DB: ${err?.message || err}`);
        continue;
      }

      for (const tile of tiles) {
        const imgUrl = tile.imageUrl || "";
        const deliveryDate = tile.deliveryDate || "";
        const hash = createHash("sha256").update(imgUrl + "|" + deliveryDate).digest("hex");

        let sender = tile.senderGuess;
        console.log(`[CRON]   ↳ Processing piece: ${sender?.slice(0, 40) || "(Unknown Provider)"}`);

        const imageBuffer = await loadMailImage(gmail, msgId, imgUrl);
        let ocrResult: Awaited<ReturnType<typeof runOcr>> | null = null;
        let llmResult: Awaited<ReturnType<typeof interpretMailWithGemini>> | null = null;
        let finalStoragePath: string | null = null;

        if (imageBuffer) {
          console.log("[CRON]     [Storage] Uploading crop to Supabase...");
          const storagePath = `${userId}/${msgId}/${hash}.jpg`;
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('mail-images')
            .upload(storagePath, imageBuffer, { contentType: 'image/jpeg', upsert: true });

           if (uploadError) {
             console.log(`[CRON]     [Error] Supabase Upload failed: ${uploadError.message}`);
           } else {
             finalStoragePath = uploadData?.path ?? storagePath;
           }
        }

        if (imageBuffer && process.env.GOOGLE_API_KEY) {
          const visionMode = process.env.LLM_VISION_MODE === "1";

          if (visionMode) {
            console.log("[CRON]     [Vision Mode] Analyzing image with Gemini...");
            try {
              llmResult = await interpretMailWithGeminiVision(imageBuffer);
              if (llmResult.senderName && !sender) sender = llmResult.senderName;
            } catch (err: any) {
              console.log(`[CRON]     [Error] Gemini processing failed: ${err?.message || err}`);
            }
          } else {
            try {
              console.log("[CRON]     [OCR Mode] Running Tesseract OCR...");
              ocrResult = await runOcr(imageBuffer);
              try {
                llmResult = await interpretMailWithGemini(ocrResult);
                if (llmResult.senderName && !sender) sender = llmResult.senderName;
              } catch (err: any) {
                console.log(`[CRON]     [Error] Gemini processing failed: ${err?.message || err}`);
              }
            } catch (err: any) {
              console.log(`[CRON]     [Error] OCR processing failed: ${err?.message || err}`);
            }
          }
        }

        const exists = await db
          .select({ id: mailPieces.id })
          .from(mailPieces)
          .where(and(eq(mailPieces.imgHash, hash), eq(mailPieces.userId, userId)))
          .limit(1);

        if (exists.length > 0) continue;

        try {
          await db.insert(mailPieces).values({
            emailId: msgId,
            userId,
            rawSenderText: sender ?? null,
            imgHash: hash,
            imgStoragePath: finalStoragePath,
            llmSenderName: llmResult?.senderName ?? null,
            llmRecipientName: llmResult?.recipientName ?? null,
            llmConfidence: llmResult ? Math.round(llmResult.confidence * 100) : null,
            llmMailType: llmResult?.mailType ?? null,
            llmSummary: llmResult?.shortSummary ?? null,
            llmIsImportant: llmResult?.isImportant ? 1 : null,
            llmImportanceReason: llmResult?.importanceReason ?? null,
            llmRawJson: llmResult?.rawJson ? JSON.stringify(llmResult.rawJson) : null,
          });

          inserted++;
          console.log("[CRON]     ✓ Saved piece to DB.");
        } catch (err: any) {
          console.log(`[CRON]     [Error] DB insertion failed: ${err?.message || err}`);
        }
      }
    }

    return NextResponse.json({ success: true, processed: inserted });

  } catch (err: any) {
    console.error("[CRON] Fatal Worker Error:", err);
    return NextResponse.json({ error: err?.message || "Internal failure" }, { status: 500 });
  }
}

async function loadMailImage(
  gmail: ReturnType<typeof getGmailClient>,
  messageId: string,
  imgUrl: string
): Promise<Buffer | null> {
  if (!imgUrl) return null;

  if (imgUrl.toLowerCase().startsWith("cid:")) {
    try {
      return await getImageByCid(gmail, messageId, imgUrl);
    } catch { return null; }
  }

  if (imgUrl.startsWith("http://") || imgUrl.startsWith("https://")) {
    try {
      const response = await fetch(imgUrl);
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch { return null; }
  }

  return null;
}
