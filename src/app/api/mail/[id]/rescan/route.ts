import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { mailPieces, emails } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { interpretMailWithGeminiVision } from "@/lib/llm";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pieceId = parseInt(params.id, 10);
    if (isNaN(pieceId)) {
      return NextResponse.json({ error: "Invalid mail piece ID" }, { status: 400 });
    }

    // 1. Ensure the user owns this mail piece before rescanning
    const [piece] = await db
      .select({
        id: mailPieces.id,
        userId: mailPieces.userId,
        imgStoragePath: mailPieces.imgStoragePath,
        rawSenderText: mailPieces.rawSenderText,
      })
      .from(mailPieces)
      .where(and(eq(mailPieces.id, pieceId), eq(mailPieces.userId, session.userId as string)))
      .limit(1);

    if (!piece) {
      return NextResponse.json({ error: "Mail piece not found or unauthorized" }, { status: 404 });
    }

    if (!piece.imgStoragePath) {
      return NextResponse.json({ error: "No image attached to re-scan" }, { status: 400 });
    }

    // 2. Fetch image from Supabase Storage using the public URL
    const imgUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/mail-images/${piece.imgStoragePath}`;
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) {
      return NextResponse.json({ error: "Failed to download image from Supabase" }, { status: 500 });
    }
    
    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Scan directly with Gemini Vision Processing
    const result = await interpretMailWithGeminiVision(buffer);

    // 4. Safely push new LLM metadata back down into Postgres
    await db.update(mailPieces)
      .set({
        llmSenderName: result.senderName ?? null,
        llmRecipientName: result.recipientName ?? null,
        llmConfidence: Math.round(result.confidence * 100),
        llmMailType: result.mailType ?? null,
        llmSummary: result.shortSummary ?? null,
        llmIsImportant: result.isImportant ? 1 : 0,
        llmImportanceReason: result.importanceReason ?? null,
        llmRawJson: JSON.stringify(result.rawJson) ?? null,
      })
      .where(eq(mailPieces.id, pieceId));

    // 5. Fetch updated representation object matching Item shape for UI
    const [updated] = await db
      .select({
         id: mailPieces.id,
         emailId: mailPieces.emailId,
         userId: mailPieces.userId,
         rawSenderText: mailPieces.rawSenderText,
         imgHash: mailPieces.imgHash,
         imgStoragePath: mailPieces.imgStoragePath,
         llmSenderName: mailPieces.llmSenderName,
         llmRecipientName: mailPieces.llmRecipientName,
         llmConfidence: mailPieces.llmConfidence,
         llmMailType: mailPieces.llmMailType,
         llmSummary: mailPieces.llmSummary,
         llmIsImportant: mailPieces.llmIsImportant,
         llmImportanceReason: mailPieces.llmImportanceReason,
         deliveryDate: emails.deliveryDate,
      })
      .from(mailPieces)
      .leftJoin(emails, eq(mailPieces.emailId, emails.id))
      .where(eq(mailPieces.id, pieceId))
      .limit(1);

    return NextResponse.json({ item: updated });

  } catch (error: any) {
    console.error("[Rescan] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
