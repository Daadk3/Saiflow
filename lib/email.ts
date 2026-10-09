import { Resend } from 'resend';

// Lazy instantiation only — a module-level `new Resend(...)` crashes builds
// and cold starts when the env var is absent.
function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

/**
 * Text for an HTML body or attribute. The product name is the seller's own
 * text, so it is escaped before it goes anywhere near markup: a name can
 * never add a link, an image or a style to a buyer's receipt.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A subject line is one line: no header can be smuggled in after it. */
function subjectSafe(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 150);
}

/**
 * The buyer's receipt, in Arabic and English, with the download link.
 *
 * The link is the download route's email channel; the route itself decides,
 * every time, whether the file may be delivered. Never logs the address.
 */
export async function sendPurchaseEmail({
  customerEmail,
  productName,
  downloadUrl,
}: {
  customerEmail: string;
  productName: string;
  downloadUrl: string;
}) {
  const name = escapeHtml(productName);
  const href = escapeHtml(downloadUrl);
  try {
    const result = await getResend().emails.send({
      from: 'Saiflow <noreply@saiflow.io>',
      to: customerEmail,
      subject: subjectSafe(`إيصال الشراء | Your purchase: ${productName}`),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #111111; color: #ffffff; padding: 40px; border-radius: 16px;">
          <div dir="rtl" lang="ar" style="text-align: right;">
            <h1 style="color: #14b8a6; text-align: center;">شكرًا لشرائك!</h1>
            <p style="color: #9ca3af; font-size: 16px;">
              اكتمل طلبك لـ <strong style="color: #ffffff;">${name}</strong>.
            </p>
            <p style="color: #9ca3af; font-size: 14px;">
              احتفظ بهذه الرسالة: يمكنك تحميل ملفك منها في أي وقت.
            </p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${href}" style="display: inline-block; background: #14b8a6; color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold;">
              تحميل المنتج · Download your product
            </a>
          </div>
          <div dir="ltr" lang="en" style="text-align: left;">
            <h2 style="color: #14b8a6; text-align: center; font-size: 20px;">Thank you for your purchase!</h2>
            <p style="color: #9ca3af; font-size: 16px;">
              Your order for <strong style="color: #ffffff;">${name}</strong> is complete.
            </p>
            <p style="color: #9ca3af; font-size: 14px;">
              Keep this email: you can download your file from it at any time.
            </p>
          </div>
          <p style="color: #6b7280; font-size: 12px; text-align: center;">
            © SaiFlow
          </p>
        </div>
      `,
    });
    // Resend reports a refusal in the result rather than by throwing.
    if (result.error) {
      console.error('Failed to send purchase email:', result.error.name);
      return;
    }
    console.log('Purchase email sent');
  } catch (error) {
    console.error('Failed to send purchase email:', error instanceof Error ? error.name : 'Error');
  }
}
