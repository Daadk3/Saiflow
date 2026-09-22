/**
 * Simple in-memory rate limiter for API routes
 * For production at scale, consider using Redis-based rate limiting
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes.
const cleanupTimer: unknown = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);
// The timer must never be the only thing keeping a process alive: a route
// test that imports this module would otherwise never exit. A running server
// keeps the process alive on its own, so nothing is lost in production.
if (typeof (cleanupTimer as { unref?: unknown }).unref === "function") {
  (cleanupTimer as { unref: () => void }).unref();
}

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
}

export function rateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  // If no entry or window expired, create new entry
  if (!entry || entry.resetTime < now) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + config.windowMs,
    };
    rateLimitStore.set(identifier, newEntry);
    return {
      success: true,
      remaining: config.maxRequests - 1,
      resetTime: newEntry.resetTime,
    };
  }

  // Increment count
  entry.count++;

  // Check if over limit
  if (entry.count > config.maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  return {
    success: true,
    remaining: config.maxRequests - entry.count,
    resetTime: entry.resetTime,
  };
}

/**
 * Get client IP from request headers
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const rateLimiters = {
  // Auth endpoints: 5 requests per minute
  auth: (ip: string) =>
    rateLimit(`auth:${ip}`, { windowMs: 60 * 1000, maxRequests: 5 }),

  // Signup: 3 requests per hour (prevent mass account creation)
  signup: (ip: string) =>
    rateLimit(`signup:${ip}`, { windowMs: 60 * 60 * 1000, maxRequests: 3 }),

  // Password reset: 3 requests per hour
  passwordReset: (ip: string) =>
    rateLimit(`password-reset:${ip}`, { windowMs: 60 * 60 * 1000, maxRequests: 3 }),

  // General API: 100 requests per minute
  api: (ip: string) =>
    rateLimit(`api:${ip}`, { windowMs: 60 * 1000, maxRequests: 100 }),

  // Product reports: 5 per hour (genuine abuse reports are rare; spam is not)
  report: (ip: string) =>
    rateLimit(`report:${ip}`, { windowMs: 60 * 60 * 1000, maxRequests: 5 }),

  // Checkout: 15 per 10 minutes. A real buyer clicks once, or a handful of
  // times across a cancelled hosted page and a retry. Every call past the
  // gates writes an attempt row and asks the payment provider for a session,
  // which is exactly what an abuser would be spending.
  checkout: (ip: string) =>
    rateLimit(`checkout:${ip}`, { windowMs: 10 * 60 * 1000, maxRequests: 15 }),
};
