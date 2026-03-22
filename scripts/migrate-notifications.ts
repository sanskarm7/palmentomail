import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db/client");

  console.log("⚠️ Initializing manual Postgres schema injection for recipient_notifications...");

  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS "recipient_notifications" (
        "id" serial PRIMARY KEY NOT NULL,
        "recipient_name" varchar(255) NOT NULL,
        "alert_email" varchar(255) NOT NULL,
        "created_at" timestamp DEFAULT now(),
        CONSTRAINT "recipient_notifications_recipient_name_unique" UNIQUE("recipient_name")
      );
    `);
    
    console.log("✅ TABLE CREATED SUCCESSFULLY: recipient_notifications");
  } catch (err: any) {
    console.error("❌ ERROR: Failed to create table:", err?.message || err);
  } finally {
    process.exit(0);
  }
}

main();
