import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db/client");
  const { mailPieces, recipientNotifications } = await import("../src/db/schema");
  const { sendRecipientNotification } = await import("../src/lib/email");

  console.log("⚠️ Starting Resend Evaluation Simulation Using Existing Postgres Data...");

  try {
    const notifications = await db.select().from(recipientNotifications);
    
    if (notifications.length === 0) {
      console.log("❌ No recipients registered in the 'recipient_notifications' table! Please execute the SQL INSERT script first.");
      process.exit(1);
    }

    const allPieces = await db.select().from(mailPieces);
    console.log(`-> Loaded ${allPieces.length} structural mail piece(s) from Postgres history.`);

    if (allPieces.length === 0) {
      console.log("❌ Database is empty! You must 'Fetch Mail' at least once to populate the simulator target.");
      process.exit(1);
    }

    // Map DB rows to NotificationItem format
    const formattedPieces = allPieces.map(p => ({
      llmRecipientName: p.llmRecipientName,
      llmSenderName: p.llmSenderName,
      rawSenderText: p.rawSenderText,
      llmMailType: p.llmMailType,
      llmSummary: p.llmSummary,
      llmIsImportant: p.llmIsImportant,
      imgStoragePath: p.imgStoragePath
    }));

    // Group items into mapped arrays identically to the dynamic Scraper endpoint
    const groupedPieces = formattedPieces.reduce((acc, piece) => {
      const name = piece.llmRecipientName;
      if (name && name.toLowerCase() !== "current resident" && name.toLowerCase() !== "null") {
        if (!acc[name]) acc[name] = [];
        acc[name].push(piece);
      }
      return acc;
    }, {} as Record<string, any[]>);

    let dispatched = 0;

    for (const rule of notifications) {
      if (groupedPieces[rule.recipientName]) {
        console.log(`-> Dispatching simulated Resend digest for ${rule.recipientName} (${groupedPieces[rule.recipientName].length} pieces)...`);
        await sendRecipientNotification(rule.recipientName, rule.alertEmail, groupedPieces[rule.recipientName]);
        dispatched++;
      } else {
         console.log(`-> No historical mail mapped for ${rule.recipientName}. Skipping alert.`);
      }
    }

    console.log(`\n✅ Resend simulation finished completely. Successfully fired ${dispatched} structural batch(es).`);
  } catch (err: any) {
    console.error("ERROR: Failed to simulate notifications:", err?.message || err);
  } finally {
    process.exit(0);
  }
}

main();
