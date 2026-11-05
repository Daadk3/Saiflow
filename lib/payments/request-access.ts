import { env } from "@/lib/env";
import {
  checkoutAccess,
  parseFounderEmails,
  parseLivePaymentsMode,
  parseLiveStoreSlugs,
  type CheckoutAccess,
  type LivePaymentsMode,
} from "@/lib/payments/live-mode";

/**
 * Who the current request is, for checkout: the one place the checkout route
 * (the authority) and the checkout page (which only mirrors it) read it.
 *
 * The session is read only while pre-launch is on AND founder tests are
 * switched on. Otherwise the answer comes from configuration alone, exactly
 * as before this switch existed: the session code is not even loaded.
 *
 * In own_store mode the answer depends on the product's store, so callers
 * pass the slug from the database row. Without one (before the product is
 * known) the answer is "closed", which the checkout route treats as "not
 * decided yet" and asks again once it has the product.
 */
export async function currentCheckoutAccess(
  shopSlug?: string | null
): Promise<{ access: CheckoutAccess; mode: LivePaymentsMode }> {
  const mode = parseLivePaymentsMode(env.LIVE_PAYMENTS_MODE);
  if (env.PRE_LAUNCH_MODE && mode === "own_store") {
    return {
      access: checkoutAccess({
        preLaunch: true,
        mode,
        founderEmails: new Set(),
        sessionEmail: null,
        liveStoreSlugs: parseLiveStoreSlugs(env.LIVE_STORE_SLUGS),
        shopSlug,
      }),
      mode,
    };
  }
  if (!env.PRE_LAUNCH_MODE || mode !== "founder_only") {
    return {
      access: checkoutAccess({ preLaunch: env.PRE_LAUNCH_MODE, mode, founderEmails: new Set(), sessionEmail: null }),
      mode,
    };
  }
  // A session that cannot be read is nobody: closed, never an error page.
  let sessionEmail: string | null = null;
  try {
    const [{ getServerSession }, { authOptions }] = await Promise.all([
      import("next-auth"),
      import("@/app/api/auth/authOptions"),
    ]);
    const session = await getServerSession(authOptions);
    sessionEmail = session?.user?.email ?? null;
  } catch {
    sessionEmail = null;
  }
  return {
    access: checkoutAccess({
      preLaunch: true,
      mode,
      founderEmails: parseFounderEmails(env.FOUNDER_TEST_EMAILS),
      sessionEmail,
    }),
    mode,
  };
}
