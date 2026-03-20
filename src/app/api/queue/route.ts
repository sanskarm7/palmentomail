import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { emails, mailPieces } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: mailPieces.id,
      userId: mailPieces.userId,
      emailId: emails.id,
      deliveryDate: emails.deliveryDate,
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
      llmRawJson: mailPieces.llmRawJson,
      createdAt: mailPieces.createdAt,
    })
    .from(mailPieces)
    .innerJoin(emails, eq(mailPieces.emailId, emails.id))
    .where(eq(mailPieces.userId, session.userId))
    .orderBy(desc(emails.deliveryDate), desc(mailPieces.id))
    .limit(50);

  return NextResponse.json({ items: rows });
}
