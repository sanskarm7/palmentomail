import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { emails, mailPieces, users } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { cookies } from "next/headers";

export async function GET() {
  const session = await auth();
  const isGuest = cookies().get("guest_active")?.value === "true";

  if (!session && !isGuest) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let targetUserId = session?.userId;
  if (!targetUserId && isGuest) {
    const userRecord = await db.select({ id: users.id }).from(users).limit(1);
    if (userRecord.length > 0) targetUserId = userRecord[0].id;
  }

  if (!targetUserId) {
    return NextResponse.json({ items: [] });
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
    .where(eq(mailPieces.userId, targetUserId))
    .orderBy(desc(emails.deliveryDate), desc(mailPieces.id))
    .limit(50);

  return NextResponse.json({ items: rows });
}
