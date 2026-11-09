/**
 * Whether the outside-seller notice is on screen.
 *
 * The notice is a disclaimer. It never disables a control, and it never
 * decides whether a store or a product can be created.
 *
 * A signed-in marketplace admin does not see it. The session flag is set in
 * the NextAuth session callback from `isAdminEmail`, the same check the
 * founder dashboard uses. `FOUNDER_BOT_OWNER_EMAIL` is only accepted when
 * that address is already an admin, so the founder is covered without
 * sending her address to the browser. While the session is still loading
 * the notice stays off, so it does not flash for her and then disappear.
 * A signed-out visitor, on the signup page, sees it.
 */
export function shouldShowOutsideSellerNotice(
  status: "loading" | "authenticated" | "unauthenticated",
  isAdmin: boolean | undefined,
): boolean {
  if (status === "unauthenticated") return true;
  if (status !== "authenticated") return false;
  return isAdmin !== true;
}
