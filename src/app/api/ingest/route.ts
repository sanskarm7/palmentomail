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
import { interpretMailWithGemini, resetLlmCallCount } from "@/lib/llm";
import { createHash } from "crypto";
import { eq, and } from "drizzle-orm";
import { supabase } from "@/lib/supabase";

const DEFAULT_QUERY =
  'from:USPSInformeddelivery@email.informeddelivery.usps.com subject:"Daily Digest" newer_than:30d';

export const maxDuration = 60;

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

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      function sendLog(msg: string) {
        console.log(msg);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`));
      }

      try {
        const gmail = getGmailClient(accessToken);
        const query = process.env.GMAIL_QUERY || DEFAULT_QUERY;

        sendLog(`Searching Gmail...`);
        const allMessages = await listDigestMessages(gmail, query);
        const list = allMessages;
        sendLog(`Found ${allMessages.length} messages. Processing all uncached instances.`);

        resetLlmCallCount();
        let inserted = 0;

        for (const [index, msg] of list.entries()) {
          const msgId = msg.id;
          if (!msgId) continue;

          const existingEmail = await db
            .select({ id: emails.id })
            .from(emails)
            .where(and(eq(emails.id, msgId), eq(emails.userId, userId)))
            .limit(1);

          if (existingEmail.length > 0) {
            sendLog(`→ Skipped duplicate email (${msgId})`);
            continue;
          }

          sendLog(`Downloading HTML for email (${msgId})...`);

          const html = await getMessageHtml(gmail, msgId);
          if (!html) {
            sendLog("→ No HTML found in email.");
            continue;
          }

          const tiles = parseInformedDeliveryTiles(html);
          sendLog(`→ Found ${tiles.length} mail piece(s) inside.`);

          if (index === 0 && process.env.SAVE_DEBUG_EMAIL_HTML === "1") {
            const fs = await import("fs/promises");
            await fs.writeFile("./debug-email.html", html);
          }

          const emailDeliveryDate = tiles[0]?.deliveryDate || "";

          try {
            await db.insert(emails).values({
              id: msgId,
              userId,
              deliveryDate: emailDeliveryDate,
            });
          } catch (err: any) {
            sendLog(`→ Failed to log email to DB: ${err?.message || err}`);
            continue;
          }

          for (const tile of tiles) {
            const imgUrl = tile.imageUrl || "";
            const deliveryDate = tile.deliveryDate || "";
            const hash = createHash("sha256")
              .update(imgUrl + "|" + deliveryDate)
              .digest("hex");

            let sender = tile.senderGuess;
            sendLog(`  ↳ Processing piece: ${sender?.slice(0, 40) || "(Unknown Provider)"}`);

            const imageBuffer = await loadMailImage(gmail, msgId, imgUrl);
            let llmResult: Awaited<ReturnType<typeof interpretMailWithGemini>> | null = null;
            let finalStoragePath: string | null = null;

            if (imageBuffer) {
              sendLog("    [Storage] Uploading crop to Supabase...");
              const storagePath = `${userId}/${msgId}/${hash}.jpg`;
              const { data: uploadData, error: uploadError } = await supabase.storage
                .from('mail-images')
                .upload(storagePath, imageBuffer, {
                  contentType: 'image/jpeg',
                  upsert: true
                });

               if (uploadError) {
                 sendLog(`    [Error] Supabase Upload failed: ${uploadError.message}`);
               } else {
                 finalStoragePath = uploadData?.path ?? storagePath;
                 sendLog(`    [Storage] Image securely uploaded!`);
               }
            }

            if (imageBuffer && process.env.GOOGLE_API_KEY) {
              sendLog("    [Vision Mode] Analyzing image with Gemini...");
              try {
                llmResult = await interpretMailWithGemini(imageBuffer);
                sendLog(`    [Result] Assessed as: ${llmResult.senderName || "Unknown Sender"} (${llmResult.mailType})`);
                if (llmResult.senderName && !sender) sender = llmResult.senderName;
              } catch (err: any) {
                sendLog(`    [Error] Gemini processing failed: ${err?.message || err}`);
              }
            } else if (imageBuffer && !process.env.GOOGLE_API_KEY) {
              sendLog("    [Skipped] No GOOGLE_API_KEY found.");
            }

            const exists = await db
              .select({ id: mailPieces.id })
              .from(mailPieces)
              .where(and(eq(mailPieces.imgHash, hash), eq(mailPieces.userId, userId)))
              .limit(1);

            if (exists.length > 0) {
              sendLog("    ✓ Ignored duplicate piece (already in DB).");
              continue;
            }

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
              sendLog("    ✓ Saved piece to DB.");
            } catch (err: any) {
              sendLog(`    [Error] DB insertion failed: ${err?.message || err}`);
            }
          }
        }

        sendLog(`\nAll done! Inserted ${inserted} new mail pieces.`);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', inserted })}\n\n`));
      } catch (error: any) {
        if (error?.code === 401 || error?.response?.status === 401) {
          sendLog("Authentication failed. Please log in again.");
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: "unauthorized" })}\n\n`));
        } else {
          console.error("Ingest error:", error);
          sendLog(`Fatal error: ${error?.message || "Failed to ingest emails."}`);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: error?.message })}\n\n`));
        }
      } finally {
        controller.close();
      }
    }
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
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
