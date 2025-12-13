import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

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
    const { data, error } = await resend.emails.send({
      from: 'Saiflow <noreply@saiflow.io>',
      to: customerEmail,
      subject: `Your purchase: ${productName}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Purchase Confirmation</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
              <tr>
                <td align="center">
                  <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #111111; border-radius: 16px; overflow: hidden;">
                    <!-- Header -->
                    <tr>
                      <td style="background: linear-gradient(135deg, #0d9488 0%, #06b6d4 100%); padding: 32px; text-align: center;">
                        <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">
                          🎉 Thank you for your purchase!
                        </h1>
                      </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                      <td style="padding: 32px;">
                        <p style="color: #9ca3af; font-size: 16px; line-height: 24px; margin: 0 0 24px 0;">
                          Hi there! Your purchase was successful. Here are your order details:
                        </p>
                        
                        <!-- Product Card -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a1a; border-radius: 12px; margin-bottom: 24px;">
                          <tr>
                            <td style="padding: 24px;">
                              <h2 style="margin: 0 0 8px 0; color: #ffffff; font-size: 20px; font-weight: 600;">
                                ${productName}
                              </h2>
                              <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 14px;">
                                Sold by ${shopName}
                              </p>
                              <p style="margin: 0; color: #0d9488; font-size: 24px; font-weight: bold;">
                                $${productPrice.toFixed(2)}
                              </p>
                            </td>
                          </tr>
                        </table>
                        
                        <!-- Download Button -->
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td align="center">
                              <a href="${downloadUrl}" style="display: inline-block; background-color: #0d9488; color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 600;">
                                📥 Download Your File
                              </a>
                            </td>
                          </tr>
                        </table>
                        
                        <p style="color: #6b7280; font-size: 14px; line-height: 20px; margin: 24px 0 0 0; text-align: center;">
                          This download link will remain active. You can access it anytime.
                        </p>
                      </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                      <td style="padding: 24px; border-top: 1px solid #1f2937; text-align: center;">
                        <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">
                          Powered by <span style="color: #0d9488; font-weight: 600;">Saiflow</span>
                        </p>
                        <p style="margin: 0; color: #4b5563; font-size: 12px;">
                          If you have any questions, reply to this email.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
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
