import { db } from "../src/db/client";
import { mailPieces, emails } from "../src/db/schema";
import "dotenv/config";

async function main() {
  console.log("⚠️ Initializing complete destructive wipe of Postgres ingestion tables...");

  try {
    // Because mailPieces references emails via foreign key (if one exists), 
    // it's safest to wipe the child tables first.
    console.log("-> Truncating physical mail pieces...");
    await db.delete(mailPieces);
    
    console.log("-> Truncating master email history...");
    await db.delete(emails);

    console.log("✅ WIPE COMPLETE. Your database is completely empty and ready for a fresh 30-day API scrape.");
  } catch (err: any) {
    console.error("❌ ERROR: Failed to wipe database:", err?.message || err);
  } finally {
    process.exit(0);
  }
}

main();
