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
 * A signed-in user who already owns a store with sales turned on does not
 * see it either: that store is on sale, so the "outside sellers are not
 * selling yet" disclaimer no longer applies to them. While that ownership
 * check is still in flight (`null`), the notice stays off so it does not
 * flash and then disappear. A signed-out visitor, on the signup page, sees it.
 */
export function shouldShowOutsideSellerNotice(
  status: "loading" | "authenticated" | "unauthenticated",
  isAdmin: boolean | undefined,
  ownsSalesEnabledShop: boolean | null = false,
): boolean {
  if (status === "unauthenticated") return true;
  if (status !== "authenticated") return false;
  if (isAdmin === true) return false;
  if (ownsSalesEnabledShop === null || ownsSalesEnabledShop === true) return false;
  return true;
}
