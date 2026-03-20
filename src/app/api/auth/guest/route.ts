import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accessCodes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  try {
    const { code } = await request.json();
    if (!code) return NextResponse.json({ error: "No code provided" }, { status: 400 });

    const codeRecord = await db
      .select({ id: accessCodes.id })
      .from(accessCodes)
      .where(and(eq(accessCodes.code, code), eq(accessCodes.isActive, true)))
      .limit(1);

    if (codeRecord.length === 0) {
      return NextResponse.json({ error: "Invalid or inactive code" }, { status: 401 });
    }

    cookies().set("guest_active", "true", {
      httpOnly: false, // Allow client-side JS to check if they are a guest!
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
