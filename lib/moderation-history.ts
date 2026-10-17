import type { ModerationAction, ModerationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * A product's moderation decisions, newest first, for the founder's review
 * page: who decided what, when, and why.
 *
 * The reason for every rejection is already stored on its ModerationEvent
 * (app/api/admin/moderation) and emailed to the seller; this reads it back so
 * the founder sees it beside the product instead of only in the seller's
 * inbox. Reports and scanner verdicts are left out: this is the decision
 * trail, not the whole log.
 *
 * Who decided is shown by name or address for an admin, and as "seller" or
 * "system" otherwise. An admin page only (app/dashboard/admin).
 */

const DECISIONS: ModerationAction[] = ["SUBMITTED", "RESUBMITTED", "APPROVED", "REJECTED"];

export interface DecisionEntry {
  action: ModerationAction;
  newStatus: ModerationStatus | null;
  /** As stored; null for a decision recorded without one. */
  reason: string | null;
  by: "admin" | "seller" | "system";
  /** An admin's name or address. Null for sellers and the system. */
  byName: string | null;
  at: Date;
}

export async function getDecisionHistory(productId: string, take = 10): Promise<DecisionEntry[]> {
  const events = await prisma.moderationEvent.findMany({
    where: { productId, action: { in: DECISIONS } },
    orderBy: { createdAt: "desc" },
    take,
    select: { action: true, newStatus: true, reason: true, actor: true, createdAt: true },
  });

  const adminIds = [
    ...new Set(events.map((e) => e.actor).filter((a) => a.startsWith("admin:")).map((a) => a.slice("admin:".length))),
  ];
  const admins = adminIds.length
    ? await prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true, email: true } })
    : [];
  const nameOf = new Map(admins.map((a) => [a.id, a.name || a.email]));

  return events.map((e) => {
    const [kind, id] = e.actor.split(":", 2);
    const by = kind === "admin" ? "admin" : kind === "seller" ? "seller" : "system";
    return {
      action: e.action,
      newStatus: e.newStatus,
      reason: e.reason?.trim() || null,
      by,
      byName: by === "admin" ? nameOf.get(id) ?? null : null,
      at: e.createdAt,
    };
  });
}

/** The rejection that put the product where it is, if it is rejected: the newest REJECTED decision. */
export function latestRejection(history: DecisionEntry[]): DecisionEntry | null {
  return history.find((entry) => entry.action === "REJECTED") ?? null;
}
