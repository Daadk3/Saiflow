import { Resend } from 'resend';

// Lazy instantiation only — a module-level `new Resend(...)` crashes builds
// and cold starts when the env var is absent.
function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

/**
 * The "confirm your email" message. Arabic first, then English, because the
 * address is not yet tied to a language preference.
 *
 * Returns whether the provider accepted it. The SDK resolves with
 * `{ error }` rather than throwing for API-level failures, so both paths are
 * checked. Only the error name is logged: never the address or the link,
 * which carries a live token.
 */
export async function sendVerificationEmail({ to, url }: { to: string; url: string }): Promise<boolean> {
  try {
    const { error } = await getResend().emails.send({
      from: 'Saiflow <noreply@saiflow.io>',
      to,
      subject: 'أكّد بريدك الإلكتروني | Confirm your email — SaiFlow',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #111111; color: #ffffff; padding: 40px; border-radius: 16px;">
          <div dir="rtl" style="text-align: right;">
            <h1 style="color: #14b8a6; font-size: 22px;">أكّد بريدك الإلكتروني</h1>
            <p style="color: #9ca3af; font-size: 16px; line-height: 26px;">افتح الرابط وأدخل كلمة مرور حسابك لتأكيد هذا البريد. صلاحية الرابط ٢٤ ساعة.</p>
            <p style="color: #6b7280; font-size: 14px; line-height: 22px;">إذا لم تنشئ حساباً على SaiFlow فتجاهل هذه الرسالة.</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${url}" style="display: inline-block; background: #14b8a6; color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold;">
              تأكيد البريد · Confirm email
            </a>
          </div>
          <div dir="ltr" style="text-align: left;">
            <h2 style="color: #14b8a6; font-size: 18px;">Confirm your email</h2>
            <p style="color: #9ca3af; font-size: 15px; line-height: 24px;">Open the link and enter your account password to confirm this address. The link expires in 24 hours.</p>
            <p style="color: #6b7280; font-size: 14px; line-height: 22px;">If you did not create a SaiFlow account, ignore this email.</p>
          </div>
          <p style="color: #4b5563; font-size: 12px; line-height: 18px; margin-top: 24px; word-break: break-all;">${url}</p>
        </div>
      `,
    });
    if (error) {
      console.error('[verify-email] provider rejected the message:', error.name);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[verify-email] send failed:', (error as Error)?.name);
    return false;
  }
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
