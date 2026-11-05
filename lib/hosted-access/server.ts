import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/app/api/auth/authOptions";
import {
  authorizeHostedAccess,
  type HostedAccessCredentials,
  type HostedAccessDecision,
  type HostedAccessDeps,
} from "@/lib/hosted-access/authorize";

/**
 * lib/hosted-access/authorize wired to the database and the session.
 *
 * The only module that selects HostedAccess.accessUrl for a buyer. Each
 * select below names exactly the columns the decision reads.
 */

const ORDER_SELECT = {
  id: true,
  productId: true,
  customerEmail: true,
  paymentProvider: true,
  paymentEnvironment: true,
  createdAt: true,
} as const;

export const hostedAccessDeps = (): HostedAccessDeps => ({
  findOrderByMerchantReference: (ref) =>
    prisma.order.findUnique({ where: { merchantReferenceId: ref }, select: ORDER_SELECT }),
  findOrderById: (id) => prisma.order.findUnique({ where: { id }, select: ORDER_SELECT }),
  findProduct: (id) =>
    prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        deliveryType: true,
        moderationStatus: true,
        shop: { select: { isActive: true, name: true } },
        hostedAccess: { select: { accessUrl: true, instructions: true } },
      },
    }),
  sessionEmail: async () => {
    const session = await getServerSession(authOptions);
    return session?.user?.email?.trim().toLowerCase() || null;
  },
  isAdmin: isAdminEmail,
  vercelEnv: process.env.VERCEL_ENV,
  receiptSecret: env.NEXTAUTH_SECRET,
});

export function authorizeHostedAccessRequest(credentials: HostedAccessCredentials): Promise<HostedAccessDecision> {
  return authorizeHostedAccess(credentials, hostedAccessDeps());
}
