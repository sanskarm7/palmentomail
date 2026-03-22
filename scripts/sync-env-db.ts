import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db/client");
  const { mailPieces, recipientNotifications } = await import("../src/db/schema");
  const { findCanonicalName } = await import("../src/lib/name-matcher");
  const { eq } = await import("drizzle-orm");

  console.log("⚠️ Synchronizing Postgres Database to the new .env.local canonical names...");

  const pinnedEnv = process.env.NEXT_PUBLIC_PINNED_RECIPIENTS || "";
  const envNames = pinnedEnv.split(",").map(n => n.trim()).filter(Boolean);

  console.log(`-> Loaded ${envNames.length} Master Rules from .env.local:`, envNames);

  if (envNames.length === 0) {
    console.log("❌ No names found in NEXT_PUBLIC_PINNED_RECIPIENTS! Check your .env.local file.");
    process.exit(1);
  }

  try {
    // 1. Sync the Notification Email Routing Table
    const notifications = await db.select().from(recipientNotifications);
    for (const rule of notifications) {
      const newCanonical = findCanonicalName(rule.recipientName, envNames);
      if (newCanonical !== rule.recipientName) {
         console.log(`   [Webhook Rule] Migrating mapping target '${rule.recipientName}' -> '${newCanonical}'`);
         await db.update(recipientNotifications)
           .set({ recipientName: newCanonical })
           .where(eq(recipientNotifications.id, rule.id));
      }
    }

    // 2. Sync all Historical Mail Pieces
    console.log(`-> Sweeping Postgres history to re-align orphaned mail piece identifiers...`);
    const allPieces = await db.select().from(mailPieces);
    let updatedPieces = 0;
    
    for (const p of allPieces) {
      if (!p.llmRecipientName) continue;
      const newName = findCanonicalName(p.llmRecipientName, envNames);
      
      if (newName !== p.llmRecipientName) {
        console.log(`   [Inbox Sweep] Re-assigning Mail ID ${p.id}: '${p.llmRecipientName}' -> '${newName}'`);
        await db.update(mailPieces)
          .set({ llmRecipientName: newName })
          .where(eq(mailPieces.id, p.id));
        updatedPieces++;
      }
    }

    console.log(`\n✅ Global .env.local synchronization flawlessly completed!`);
    console.log(`   Merged ${updatedPieces} old mail piece(s) and aligned UI hooks completely.`);
  } catch (err: any) {
    console.error("ERROR: Failed to run synchronization:", err?.message || err);
  } finally {
    process.exit(0);
  }
}

main();
