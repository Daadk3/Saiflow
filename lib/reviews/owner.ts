/**
 * Whether the signed-in user owns the shop. Reporting a review is the
 * owner's action; other shop roles cannot do it, and neither can the buyer.
 */

import { prisma } from "@/lib/prisma";

export async function isShopOwner(email: string | null | undefined, shopId: string): Promise<boolean> {
  if (!email) return false;
  const membership = await prisma.shopUser.findFirst({
    where: {
      shopId,
      role: "OWNER",
      user: { email: { equals: email, mode: "insensitive" } },
    },
    select: { id: true },
  });
  return membership !== null;
}
