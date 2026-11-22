-- Manual data change. Do NOT apply this with the app deploy.
-- Run it only after review, against the production database, as its own step.
--
-- Why it is not a Prisma migration: it rewrites a live shop's public URL.
-- The app redirect (lib/shop-slug-redirect.ts) stays off while the row is
-- still `daad-s-store`, and starts returning 308 once this update has
-- committed and `sahab-store` is the active shop. Deploy the app first or
-- second; the order does not break existing links.
--
-- The store is already named Sahab Store. This statement changes the slug
-- only. It refuses to run if another shop already owns `sahab-store`.

BEGIN;

UPDATE "Shop"
SET "slug" = 'sahab-store',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'daad-s-store'
  AND NOT EXISTS (
    SELECT 1 FROM "Shop" existing WHERE existing."slug" = 'sahab-store'
  );

-- Expect one row. Zero rows means the slug was already renamed, or
-- `sahab-store` is taken and needs a human look before anything moves.
-- Product URLs do not store the shop slug, so no other table changes.

COMMIT;
