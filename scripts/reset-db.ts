import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db/client");
  const { mailPieces, emails } = await import("../src/db/schema");

  console.log("⚠️ Initializing complete destructive wipe of Postgres ingestion tables...");

  try {
    // Because mailPieces references emails via foreign key (if one exists), 
    // it's safest to wipe the child tables first.
    console.log("-> Truncating physical mail pieces...");
    await db.delete(mailPieces);

    console.log("-> Truncating master email history...");
    await db.delete(emails);

    console.log("WIPE COMPLETE. Your database is completely empty and ready for a fresh 30-day API scrape.");
  } catch (err: any) {
    console.error("ERROR: Failed to wipe database:", err?.message || err);
  } finally {
    process.exit(0);
  }
}

main();
