import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";
import crypto from "crypto";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { forgotPasswordSchema, formatZodError } from "@/lib/validations";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    // Rate limiting
    const ip = getClientIp(req);
    const rateLimitResult = rateLimiters.passwordReset(ip);

    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "Too many password reset attempts. Please try again later.",
          retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
            ),
          },
        }
      );
    }

    const body = await req.json();

    // Validate input
    const validationResult = forgotPasswordSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: formatZodError(validationResult.error) },
        { status: 400 }
      );
    }

    const { email } = validationResult.data;

    // Find user by email (case-insensitive)
    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({
        message: "If an account exists, we've sent a reset link to your email",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

    // Save token to database
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken,
        resetTokenExpiry,
      },
    });

    // Create reset URL
    const baseUrl = process.env.NEXTAUTH_URL || "https://saiflow.io";
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    // Send email
    const { error: emailError } = await resend.emails.send({
      from: "Saiflow <noreply@saiflow.io>",
      to: email,
      subject: "Reset your Saiflow password",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Reset Your Password</title>
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
                          Reset Your Password
                        </h1>
                      </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                      <td style="padding: 32px;">
                        <p style="color: #9ca3af; font-size: 16px; line-height: 24px; margin: 0 0 24px 0;">
                          Hi there! We received a request to reset your password for your Saiflow account.
                        </p>

                        <p style="color: #9ca3af; font-size: 16px; line-height: 24px; margin: 0 0 24px 0;">
                          Click the button below to set a new password. This link will expire in 1 hour.
                        </p>

                        <!-- Reset Button -->
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td align="center" style="padding: 16px 0;">
                              <a href="${resetUrl}" style="display: inline-block; background-color: #0d9488; color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 600;">
                                Reset Password
                              </a>
                            </td>
                          </tr>
                        </table>

                        <p style="color: #6b7280; font-size: 14px; line-height: 20px; margin: 24px 0 0 0;">
                          If you didn't request a password reset, you can safely ignore this email. Your password won't be changed.
                        </p>

                        <p style="color: #4b5563; font-size: 12px; line-height: 18px; margin: 24px 0 0 0; padding-top: 16px; border-top: 1px solid #1f2937;">
                          If the button doesn't work, copy and paste this link into your browser:<br>
                          <a href="${resetUrl}" style="color: #0d9488; word-break: break-all;">${resetUrl}</a>
                        </p>
                      </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                      <td style="padding: 24px; border-top: 1px solid #1f2937; text-align: center;">
                        <p style="margin: 0; color: #6b7280; font-size: 14px;">
                          Powered by <span style="color: #0d9488; font-weight: 600;">Saiflow</span>
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

    if (emailError) {
      console.error("Error sending reset email:", emailError);
      return NextResponse.json(
        { error: "Failed to send reset email" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "If an account exists, we've sent a reset link to your email",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
