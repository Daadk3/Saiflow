import { z } from "zod";

/**
 * Validation schemas for API requests
 */

/**
 * Only allow files/thumbnails/logos hosted on our storage provider.
 * Blocks javascript:/data: URLs and arbitrary external hosts from being
 * stored and later rendered or redirected to.
 */
export function isAllowedAssetUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname === "utfs.io" ||
        u.hostname.endsWith(".ufs.sh") ||
        u.hostname.endsWith(".uploadthing.com"))
    );
  } catch {
    return false;
  }
}

/**
 * The storage object key behind an asset URL, or null if the URL is not one of
 * ours or is not shaped like a stored object.
 *
 * Deriving the key rather than accepting it from the client is the whole point.
 * A client-supplied key could be pointed at a different object than the URL it
 * claims to describe, which would let a seller attach one file's SAFE verdict
 * to another file's bytes. Because the key is parsed out of the same string
 * that is stored as `fileUrl`, the two can never disagree.
 *
 * Accepts exactly `https://<allowed-host>/f/<key>` — one path segment after
 * `/f/`, nothing more. Anything else returns null and the caller rejects.
 */
export function extractAssetKey(url: unknown): string | null {
  if (!isAllowedAssetUrl(url)) return null;
  try {
    const { pathname } = new URL(url);
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length !== 2 || segments[0] !== "f") return null;
    const key = segments[1];
    return /^[A-Za-z0-9_-]{8,128}$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

/**
 * SaiFlow's own storage host, `<appId>.ufs.sh`.
 *
 * Verified against the installed `uploadthing` 7.7.4: file URLs are built as
 * `https://<appId>.<ufsHost>/f/<key>`, where `ufsHost` defaults to `"ufs.sh"`
 * and the app id is placed in the subdomain
 * (`UfsHost` / `UfsAppIdLocation` in `dist/upload-builder`). SaiFlow overrides
 * neither, so the default form applies.
 *
 * Returns null when the app id is unconfigured. Callers MUST read that as
 * "reject", never as "allow anything".
 */
export function ownAssetHost(
  appId: string | undefined = process.env.UPLOADTHING_APP_ID
): string | null {
  const id = appId?.trim().toLowerCase();
  return id ? `${id}.ufs.sh` : null;
}

/**
 * Key extraction for a value being WRITTEN to a product.
 *
 * Deliberately stricter than `extractAssetKey`, which only proves a URL is
 * shaped like an UploadThing object. That check accepts *any* tenant's
 * subdomain and the shared `utfs.io` domain, so a seller could point a
 * deliverable at a file uploaded to their own personal UploadThing account —
 * bypassing the type and size allowlist entirely, because such a file never
 * travelled through our upload route.
 *
 * A write must therefore land on our own app host. `utfs.io` is excluded on
 * purpose: it is shared by every UploadThing tenant, so a URL there can never
 * demonstrate ownership. Existing `utfs.io` rows keep working because callers
 * apply this check only to values that actually change.
 *
 * Fails closed when the app id is unconfigured.
 */
export function extractOwnAssetKey(
  url: unknown,
  appId?: string
): string | null {
  const host = ownAssetHost(appId);
  if (!host) return null;

  const key = extractAssetKey(url);
  if (!key) return null;

  try {
    return new URL(url as string).hostname.toLowerCase() === host ? key : null;
  } catch {
    return null;
  }
}

// Auth schemas
export const signupSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be less than 100 characters")
    .trim(),
  email: z
    .string()
    .email("Invalid email address")
    .max(255, "Email must be less than 255 characters")
    .toLowerCase()
    .trim(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be less than 128 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
});

export const loginSchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .max(255, "Email must be less than 255 characters")
    .toLowerCase()
    .trim(),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .max(255, "Email must be less than 255 characters")
    .toLowerCase()
    .trim(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be less than 128 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
});

// Shop schemas
export const createShopSchema = z.object({
  name: z
    .string()
    .min(2, "Shop name must be at least 2 characters")
    .max(100, "Shop name must be less than 100 characters")
    .trim(),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(50, "Slug must be less than 50 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and hyphens"
    )
    .trim(),
  description: z
    .string()
    .max(1000, "Description must be less than 1000 characters")
    .optional(),
});

export const updateShopSchema = createShopSchema.partial();

// Product schemas
export const createProductSchema = z.object({
  name: z
    .string()
    .min(2, "Product name must be at least 2 characters")
    .max(200, "Product name must be less than 200 characters")
    .trim(),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(100, "Slug must be less than 100 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and hyphens"
    )
    .trim(),
  description: z
    .string()
    .max(10000, "Description must be less than 10000 characters")
    .optional(),
  price: z
    .number()
    .min(0, "Price cannot be negative")
    .max(10000, "Price cannot exceed $10,000"),
  shopId: z.string().min(1, "Shop ID is required"),
});

export const updateProductSchema = createProductSchema.partial().omit({ shopId: true });

// Helper to format Zod errors
export function formatZodError(error: z.ZodError<unknown>): string {
  return error.issues.map((issue) => issue.message).join(", ");
}

// Type exports
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type CreateShopInput = z.infer<typeof createShopSchema>;
export type UpdateShopInput = z.infer<typeof updateShopSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
