import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { signupSchema, formatZodError } from "@/lib/validations";
import { issueVerificationToken, verificationUrl } from "@/lib/auth/email-verification";
import { sendVerificationEmail } from "@/lib/email";
import { POLICY_VERSION } from "@/lib/policy";

export async function POST(req: Request) {
  try {
    // Rate limiting
    const ip = getClientIp(req);
    const rateLimitResult = rateLimiters.signup(ip);

    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "Too many signup attempts. Please try again later.",
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
    const validationResult = signupSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: formatZodError(validationResult.error) },
        { status: 400 }
      );
    }

    const { name, email, password } = validationResult.data;

    // Check for existing user (case-insensitive)
    const existingUser = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "A user with this email already exists." },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Store email as lowercase. The account starts unverified and cannot sign
    // in until its owner confirms the address from the emailed link.
    // signupSchema has already required both consent flags, so this row is
    // written only after the person agreed to the current Terms and confirmed
    // they are 18 or older. The age confirmation is that gate; it is not a
    // separate column. The terms version is the policy they accepted.
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        termsAcceptedAt: new Date(),
        termsVersion: POLICY_VERSION,
      },
      select: {
        id: true,
        email: true,
      },
    });

    // A failed send still leaves a valid account: the login page offers to
    // resend the link, so the user is told to check their inbox either way.
    const token = await issueVerificationToken(user);
    const verificationEmailSent = await sendVerificationEmail({
      to: user.email,
      url: verificationUrl(token),
    });

    return NextResponse.json({ message: "Check your email to verify your account.", verificationEmailSent });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
