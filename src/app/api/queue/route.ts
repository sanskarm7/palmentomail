import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { messages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.userId, session.userId))
    .orderBy(desc(messages.id))
    .limit(50);

  return NextResponse.json({ items: rows });
}
