import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import { validateAccessInstructions, validateHostedUrl } from "@/lib/hosted-access/validate";

/**
 * A hosted-access product's private details for the admin review page.
 *
 * The caller passes the signed-in address and this checks it again, so the
 * link cannot be read through this function by anyone but an admin even if
 * it is later imported from somewhere else. The stored values are checked
 * against today's rules and the result is shown beside them, so the admin
 * sees when a link would now be refused.
 */
export interface AdminHostedAccessView {
  accessUrl: string;
  host: string | null;
  instructions: string | null;
  urlOk: boolean;
  instructionsOk: boolean;
  updatedAt: Date;
}

export async function getHostedAccessForAdmin(
  productId: string,
  adminEmail: string | null | undefined
): Promise<AdminHostedAccessView | null> {
  if (!isAdminEmail(adminEmail)) return null;
  const row = await prisma.hostedAccess.findUnique({
    where: { productId },
    select: { accessUrl: true, instructions: true, updatedAt: true },
  });
  if (!row) return null;
  const url = validateHostedUrl(row.accessUrl);
  const instructions = validateAccessInstructions(row.instructions);
  let host: string | null = null;
  try {
    host = new URL(row.accessUrl).host;
  } catch {
    host = null;
  }
  return {
    accessUrl: row.accessUrl,
    host,
    instructions: row.instructions,
    urlOk: url.ok,
    instructionsOk: instructions.ok,
    updatedAt: row.updatedAt,
  };
}
