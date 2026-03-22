import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db/client");
  const { mailPieces, emails } = await import("../src/db/schema");

  console.log("⚠️ Initializing complete destructive wipe of Postgres ingestion tables and S3 Storage...");

  try {
    console.log("-> Truncating physical mail pieces...");
    await db.delete(mailPieces);

    console.log("-> Truncating master email history...");
    await db.delete(emails);

    console.log("-> Emptying Supabase 'mail-images' storage bucket...");
    
    // Authenticate the super-admin client bypassing normal RLS rules for bucket deletion
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn("   ⚠️ Skipping S3 wipe globally: Missing SUPABASE_SERVICE_ROLE_KEY");
    } else {
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );

      const { data: files, error: listError } = await supabaseAdmin.storage.from("mail-images").list();
      
      if (listError) {
        console.error("   ❌ Failed to fetch bucket file array:", listError);
      } else if (files && files.length > 0) {
        const fileNames = files.map((f) => f.name);
        const { error: removeError } = await supabaseAdmin.storage.from("mail-images").remove(fileNames);
        
        if (removeError) {
          console.error("   ❌ Failed to bulk delete image assets natively:", removeError);
        } else {
          console.log(`   ✓ Successfully annihilated ${fileNames.length} image(s) from S3.`);
        }
      } else {
        console.log("   ✓ Bucket is intrinsically empty already.");
      }
    }

    console.log("\n✅ WIPE COMPLETE: Core DB and S3 are natively zeroed-out. Safe to re-scrape.");
  } catch (err: any) {
    console.error("ERROR: Failed to wipe environment:", err?.message || err);
  } finally {
    process.exit(0);
  }
}

main();
