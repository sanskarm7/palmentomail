import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getGmailClient,
  listDigestMessages,
  getMessageHtml,
  getImageByCid,
} from "@/lib/gmail";
import { db } from "@/db/client";
import { emails, mailPieces } from "@/db/schema";
import { parseInformedDeliveryTiles } from "@/lib/parser";
import { runOcr } from "@/lib/ocr";
import { interpretMailWithGemini, interpretMailWithGeminiVision, resetLlmCallCount } from "@/lib/llm";
import { createHash } from "crypto";
import { eq, and } from "drizzle-orm";

const DEFAULT_QUERY =
  'from:USPSInformeddelivery@email.informeddelivery.usps.com subject:"Daily Digest" newer_than:60d';

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const accessToken = session.access_token;
  const userId = session.userId;

  if (!accessToken || !userId) {
    return NextResponse.json(
      {
        error:
          "no access token on session. Please sign out and sign back in to refresh your authentication.",
      },
      { status: 401 }
    );
  }

  try {
    const gmail = getGmailClient(accessToken);
    const query = process.env.GMAIL_QUERY || DEFAULT_QUERY;

    console.log("Searching Gmail with query:", query);
    const allMessages = await listDigestMessages(gmail, query);
    const maxMessages = parseInt(process.env.GMAIL_MAX_MESSAGES ?? "5", 10);
    const list = allMessages.slice(0, isNaN(maxMessages) ? 5 : maxMessages);
    console.log(`Found ${allMessages.length} messages, processing ${list.length}`);

    // Reset per-run LLM call counter (protects daily quota)
    resetLlmCallCount();

    let inserted = 0;

    for (const [index, msg] of list.entries()) {
      const msgId = msg.id;
      if (!msgId) continue;

      // Duplicate check: if email is already in the db, skip fetching HTML & LLM
      const existingEmail = await db
        .select({ id: emails.id })
        .from(emails)
        .where(and(eq(emails.id, msgId), eq(emails.userId, userId)))
        .limit(1);

      if (existingEmail.length > 0) {
        console.log(`      Skipped msg ${msgId} — already ingested`);
        continue;
      }

      console.log(`Processing message ${msgId}...`);

      const html = await getMessageHtml(gmail, msgId);
      if (!html) {
        console.log("No HTML found");
        continue;
      }

      console.log(`Downloaded HTML (${html.length} chars)`);

      const tiles = parseInformedDeliveryTiles(html);
      console.log(`Found ${tiles.length} mail piece(s)`);

      // Optional debug: save first email HTML for inspection
      if (index === 0 && process.env.SAVE_DEBUG_EMAIL_HTML === "1") {
        const fs = await import("fs/promises");
        await fs.writeFile("./debug-email.html", html);
        console.log("Saved email HTML to debug-email.html");
      }

      const emailDeliveryDate = tiles[0]?.deliveryDate || "";

      // Insert Email record
      try {
        await db.insert(emails).values({
          id: msgId,
          userId,
          deliveryDate: emailDeliveryDate,
        });
      } catch (err: any) {
        console.log(`      Failed to insert email record: ${err?.message || err}`);
        continue; // Skip processing pieces if the parent email record fails
      }

      for (const tile of tiles) {
        const imgUrl = tile.imageUrl || "";
        const deliveryDate = tile.deliveryDate || "";
        const hash = createHash("sha256")
          .update(imgUrl + "|" + deliveryDate)
          .digest("hex");

        let sender = tile.senderGuess;
        console.log(
          `Sender: ${sender?.slice(0, 40) || "(none)"}, Date: ${deliveryDate}, Hash: ${hash.slice(0, 8)}`
        );

        const imageBuffer = await loadMailImage(gmail, msgId, imgUrl);
        let ocrResult: Awaited<ReturnType<typeof runOcr>> | null = null;
        let llmResult: Awaited<ReturnType<typeof interpretMailWithGemini>> | null = null;

        if (imageBuffer && process.env.GOOGLE_API_KEY) {
          const visionMode = process.env.LLM_VISION_MODE === "1";

          if (visionMode) {
            // --- Vision path: send image directly to Gemini, skip OCR ---
            console.log("[vision] Sending image directly to Gemini");
            try {
              llmResult = await interpretMailWithGeminiVision(imageBuffer);
              console.log(
                `[vision] LLM: ${llmResult.senderName || "no sender"} (${llmResult.mailType}) confidence=${llmResult.confidence.toFixed(2)}`
              );
              if (llmResult.senderName && !sender) {
                sender = llmResult.senderName;
              }
            } catch (err: any) {
              console.log(`[vision] LLM processing failed: ${err?.message || err}`);
            }
          } else {
            // --- OCR path: run Tesseract first, then pass text to Gemini ---
            try {
              ocrResult = await runOcr(imageBuffer);
              console.log(`OCR extracted ${ocrResult.lines.length} lines`);

              try {
                llmResult = await interpretMailWithGemini(ocrResult);
                console.log(
                  `LLM: ${llmResult.senderName || "no sender"} (${llmResult.mailType}) confidence=${llmResult.confidence.toFixed(2)}`
                );
                if (llmResult.senderName && !sender) {
                  sender = llmResult.senderName;
                }
              } catch (err: any) {
                console.log(`LLM processing failed: ${err?.message || err}`);
              }
            } catch (err: any) {
              console.log(`OCR processing failed: ${err?.message || err}`);
            }
          }
        } else if (imageBuffer && !process.env.GOOGLE_API_KEY) {
          console.log("No GOOGLE_API_KEY — skipping LLM step");
        }

        // Check for existing mail piece in case email already had partial inserts
        const exists = await db
          .select({ id: mailPieces.id })
          .from(mailPieces)
          .where(and(eq(mailPieces.imgHash, hash), eq(mailPieces.userId, userId)))
          .limit(1);

        if (exists.length > 0) {
          console.log("      Skipped (duplicate mail piece)");
          continue;
        }

        try {
          await db.insert(mailPieces).values({
            emailId: msgId,
            userId,
            rawSenderText: sender ?? null,
            imgHash: hash,
            llmSenderName: llmResult?.senderName ?? null,
            llmRecipientName: llmResult?.recipientName ?? null,
            // Store confidence as 0–100 integer (e.g. 0.87 → 87)
            llmConfidence: llmResult
              ? Math.round(llmResult.confidence * 100)
              : null,
            llmMailType: llmResult?.mailType ?? null,
            llmSummary: llmResult?.shortSummary ?? null,
            llmIsImportant: llmResult?.isImportant ? 1 : null,
            llmImportanceReason: llmResult?.importanceReason ?? null,
            llmRawJson: llmResult?.rawJson
              ? JSON.stringify(llmResult.rawJson)
              : null,
          });

          inserted++;
          console.log("      Inserted mail piece");
        } catch (err: any) {
          console.log(`      Insert piece error: ${err?.message || err}`);
        }
      }
    }

    console.log(`Total inserted: ${inserted}`);
    return NextResponse.json({ ok: true, inserted });
  } catch (error: any) {
    if (error?.code === 401 || error?.response?.status === 401) {
      return NextResponse.json(
        {
          error:
            "authentication failed. Please sign out and sign back in to refresh your access token.",
        },
        { status: 401 }
      );
    }

    console.error("Ingest error:", error);
    return NextResponse.json(
      { error: error?.message || "failed to ingest emails" },
      { status: 500 }
    );
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
    } catch (err: any) {
      console.log(`      Failed to extract CID image: ${err?.message || err}`);
      return null;
    }
  }

  if (imgUrl.startsWith("http://") || imgUrl.startsWith("https://")) {
    try {
      const response = await fetch(imgUrl);
      if (!response.ok) {
        console.log(`      Failed to download image: HTTP ${response.status}`);
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err: any) {
      console.log(`      Failed to download remote image: ${err?.message || err}`);
      return null;
    }
  }

  return null;
}
