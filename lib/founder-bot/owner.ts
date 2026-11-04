/**
 * The founder account, and the stores she owns.
 *
 * Shop ids from the request are lookup keys only. A store is hers when a
 * ShopUser row says OWNER for her user id. Membership of someone else's
 * store is not enough, and no other user's id is ever read from the request.
 */

import { prisma } from "@/lib/prisma";

export async function loadFounderUser(email: string): Promise<{ id: string; name: string | null } | null> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  return user;
}

/** True only when this user owns this shop. A missing shop and someone else's shop are both false. */
export async function founderOwnsShop(userId: string, shopId: string): Promise<boolean> {
  if (shopId.length < 1 || shopId.length > 64) return false;
  const membership = await prisma.shopUser.findFirst({
    where: { userId, shopId, role: "OWNER" },
    select: { id: true },
  });
  return membership !== null;
}
