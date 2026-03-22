import { Resend } from 'resend';

// Dynamically instantiate to prevent crashing compiler entirely if environment variables are missing during local setup
export const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export interface NotificationItem {
  llmRecipientName: string | null;
  llmSenderName: string | null;
  rawSenderText: string | null;
  llmMailType: string | null;
  llmSummary: string | null;
  llmIsImportant: number | null;
  imgStoragePath: string | null;
}

export async function sendRecipientNotification(
  recipientName: string,
  alertEmail: string,
  newPieces: NotificationItem[]
) {
  if (!resend) {
    console.log(`[Email] Skipping alert dispatch for ${recipientName} to ${alertEmail} (RESEND_API_KEY not configured)`);
    return;
  }

  // Generate heavily styled standalone HTML components per mail piece
  const pieceHtml = newPieces.map(piece => `
    <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; font-family: sans-serif;">
      <h3 style="margin-top: 0; color: #111827;">
        ${piece.llmIsImportant ? '🚨 ' : ''}${piece.llmSenderName || piece.rawSenderText || "Unknown Sender"}
      </h3>
      <p style="color: #6b7280; font-size: 14px; margin: 4px 0;"><strong>Type:</strong> ${piece.llmMailType || "Unknown"}</p>
      <p style="color: #374151; font-size: 15px; margin: 12px 0; line-height: 1.5;">${piece.llmSummary || "No summary provided."}</p>
      
      ${piece.imgStoragePath ? `
        <div style="margin-top: 16px;">
          <img src="${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/mail-images/${piece.imgStoragePath}" 
               alt="Scanned Mail Image Thumbnail" 
               style="max-width: 100%; height: auto; border-radius: 6px; border: 1px solid #f3f4f6;" />
        </div>
      ` : ''}
    </div>
  `).join('');

  // Embed the compiled pieces into the master template body
  const htmlBody = `
    <body style="background-color: #f9fafb; padding: 24px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 32px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <h2 style="color: #111827; margin-top: 0; font-family: sans-serif;">You've got mail, ${recipientName}!</h2>
        <p style="color: #4b5563; font-size: 16px; margin-bottom: 24px; font-family: sans-serif;">
          palmentomail just scanned <strong>${newPieces.length}</strong> new piece(s) of physical mail officially addressed to you.
        </p>
        
        ${pieceHtml}
        
        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
        <p style="color: #9ca3af; font-size: 12px; text-align: center; font-family: sans-serif;">
          Sent securely via palmentomail.
        </p>
      </div>
    </body>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: 'Palmento Mail <updates@palmentomail.com>',
      to: alertEmail,
      subject: `📬 ${newPieces.length} New Mail Piece${newPieces.length > 1 ? 's' : ''} for ${recipientName}`,
      html: htmlBody,
    });

    if (error) {
      console.error(`[Email] Resend API Warning for ${alertEmail}:`, error);
    } else {
      console.log(`[Email] Successfully dispatched alert safely to ${alertEmail} (ID: ${data?.id})`);
    }
  } catch (err: any) {
    console.error(`[Email] Failed completely to trigger Resend SDK:`, err);
  }
}
