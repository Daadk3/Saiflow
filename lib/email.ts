import { Resend } from 'resend';

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

interface PurchaseEmailParams {
  customerEmail: string;
  productName: string;
  productPrice: number;
  downloadUrl: string;
  shopName: string;
}

export async function sendPurchaseConfirmationEmail({
  customerEmail,
  productName,
  productPrice,
  downloadUrl,
  shopName,
}: PurchaseEmailParams) {
  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from: 'Saiflow <noreply@saiflow.io>',
      to: customerEmail,
      subject: `Your purchase: ${productName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #0a0a0a; color: #ffffff; padding: 40px; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #14b8a6; margin: 0;">Thank you for your purchase!</h1>
          </div>
          
          <p style="color: #9ca3af; font-size: 16px; line-height: 1.6;">
            Your order for <strong style="color: #ffffff;">${productName}</strong> is complete.
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${downloadUrl}" 
               style="display: inline-block; background: linear-gradient(to right, #14b8a6, #0d9488); color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
              Download Your Product
            </a>
          </div>
          
          <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
            If you have any issues, reply to this email and we'll help you out.
          </p>
          
          <hr style="border: none; border-top: 1px solid #374151; margin: 30px 0;" />
          
          <p style="color: #6b7280; font-size: 12px; text-align: center;">
            © Saiflow - Your Digital Products Marketplace
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('Error sending email:', error);
      return { success: false, error };
    }

    console.log('Email sent successfully:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error };
  }
}
