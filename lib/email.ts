import { Resend } from 'resend';

// Lazy instantiation only — a module-level `new Resend(...)` crashes builds
// and cold starts when the env var is absent.
function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function sendPurchaseEmail({
  customerEmail,
  productName,
  downloadUrl,
}: {
  customerEmail: string;
  productName: string;
  downloadUrl: string;
}) {
  try {
    await getResend().emails.send({
      from: 'Saiflow <noreply@saiflow.io>',
      to: customerEmail,
      subject: `Your purchase: ${productName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #111111; color: #ffffff; padding: 40px; border-radius: 16px;">
          <h1 style="color: #14b8a6; text-align: center;">Thank you for your purchase!</h1>
          <p style="color: #9ca3af; font-size: 16px;">
            Your order for <strong style="color: #ffffff;">${productName}</strong> is complete.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${downloadUrl}" style="display: inline-block; background: #14b8a6; color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold;">
              Download Your Product
            </a>
          </div>
          <p style="color: #6b7280; font-size: 12px; text-align: center;">
            © Saiflow - Your Digital Products Marketplace
          </p>
        </div>
      `,
    });
    console.log('Purchase email sent to:', customerEmail);
  } catch (error) {
    console.error('Failed to send purchase email:', error);
  }
}
