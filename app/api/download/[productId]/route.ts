import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId");

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      );
    }

    // If orderId is provided, validate the order exists and belongs to this product
    if (orderId) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          productId: true,
          customerEmail: true,
        },
      });

      if (!order) {
        return NextResponse.json(
          { error: "Order not found" },
          { status: 404 }
        );
      }

      if (order.productId !== productId) {
        return NextResponse.json(
          { error: "Order does not match product" },
          { status: 403 }
        );
      }
    }

    // Fetch the product from database
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        fileUrl: true,
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    if (!product.fileUrl) {
      return NextResponse.json(
        { error: "No file available for this product. Please contact support." },
        { status: 404 }
      );
    }

    console.log(`Download requested for product ${product.name}${orderId ? ` (order: ${orderId})` : ""}, fileUrl: ${product.fileUrl}`);

    return NextResponse.json({
      productName: product.name,
      downloadUrl: product.fileUrl,
    });
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

