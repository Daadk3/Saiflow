import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../auth/authOptions";
import { createProductForSeller } from "@/lib/products/create-product";
import { createHostedProductForSeller } from "@/lib/products/hosted-product";
import { accountKey, rateLimiters, retryAfterSeconds } from "@/lib/rate-limit";

// Attaching a file schedules its scan to run after this response is sent;
// the scan moves the file twice, so this route carries the worker's budget.
// The request itself still returns as soon as the product is written.
export const maxDuration = 300;

// POST - Create a new product.
// The checks live in lib/products/create-product.ts, which the founder bot
// calls too. A route file may only export HTTP handlers, so the function
// itself is not exported from here.
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Every product past the gates costs a file scan and, once it passes, an
    // email to the founder. 20 an hour per account fits a catalogue and
    // starves an abuser, decided before the body is even read.
    const limit = rateLimiters.createProduct(accountKey(session.user.email));
    if (!limit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds(limit.resetTime)) } }
      );
    }

    const body = await req.json();
    const { name, description, price, category, shopId, fileUrl, thumbnailUrl, currency, certified, deliveryType } = body;
    // Only the two known values; anything else is refused, never defaulted.
    if (deliveryType !== undefined && deliveryType !== "FILE" && deliveryType !== "HOSTED_ACCESS") {
      return NextResponse.json({ error: "Invalid delivery type" }, { status: 400 });
    }

    // The founder bot calls createProductForSeller with the founder account
    // directly; this route only ever passes the signed-in one.
    const user = await prisma.user.findFirst({
      where: { email: { equals: session.user.email, mode: "insensitive" } },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Hosted access (e.g. an AI agent the seller hosts) has its own create
    // path; the file path below is unchanged and still requires a file.
    if (deliveryType === "HOSTED_ACCESS") {
      return await createHostedProductForSeller(user, {
        name,
        description,
        price,
        category,
        shopId,
        thumbnailUrl,
        currency,
        certified,
        accessUrl: body.accessUrl,
        accessInstructions: body.accessInstructions,
        hostedAccessCertified: body.hostedAccessCertified,
      });
    }

    return await createProductForSeller(user, {
      name,
      description,
      price,
      category,
      shopId,
      fileUrl,
      fileUrls: body.fileUrls,
      thumbnailUrl,
      currency,
      certified,
    });
  } catch (error) {
    console.error("Error creating product:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
