import { env } from "@/lib/env";
import {
  checkoutAccess,
  parseFounderEmails,
  parseLivePaymentsMode,
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
 */
export async function currentCheckoutAccess(): Promise<{ access: CheckoutAccess; mode: LivePaymentsMode }> {
  const mode = parseLivePaymentsMode(env.LIVE_PAYMENTS_MODE);
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
