import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { resetPasswordSchema, formatZodError } from "@/lib/validations";
import { hashToken } from "@/lib/auth/email-verification";

export async function POST(req: Request) {
  try {
    // Rate limiting
    const ip = getClientIp(req);
    const rateLimitResult = rateLimiters.auth(ip);

    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "Too many attempts. Please try again later.",
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
    const validationResult = resetPasswordSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: formatZodError(validationResult.error) },
        { status: 400 }
      );
    }

    const { token, password } = validationResult.data;

    // Only the token's hash is stored (app/api/auth/forgot-password).
    const tokenHash = hashToken(token);
    const user = await prisma.user.findUnique({
      where: { resetToken: tokenHash },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid or expired reset token" },
        { status: 400 }
      );
    }

    // Check if token has expired
    if (!user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return NextResponse.json(
        { error: "Reset token has expired. Please request a new one." },
        { status: 400 }
      );
    }

    // Hash new password
    const hashedPassword = await hashPassword(password);

    // Update password and clear reset token. Completing a reset proves the
    // inbox, and the password is now one its owner chose, so the address
    // counts as verified. This is also how an owner reclaims an address that
    // someone else registered first: the old password, and every session
    // opened with it, stop working here.
    //
    // One use only: the write matches only while this exact token is still
    // stored and unexpired, so two requests racing with the same link cannot
    // both set a password.
    const used = await prisma.user.updateMany({
      where: { id: user.id, resetToken: tokenHash, resetTokenExpiry: { gt: new Date() } },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
        emailVerified: user.emailVerified ?? new Date(),
      },
    });
    if (used.count !== 1) {
      return NextResponse.json(
        { error: "Invalid or expired reset token" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("[reset-password] failed", (error as Error)?.name ?? "Error");
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
