/**
 * SaiFlow's commission, computed the one way everything computes it.
 *
 * THE RULE (approved September 2026):
 *   - The creator enters the FINAL price the buyer pays.
 *   - SaiFlow's commission is 7% of that price.
 *   - The seller's share is the rest. Payment-processing fees are SaiFlow's
 *     own cost: never deducted from the seller, never shown to them.
 *
 * THE ARITHMETIC: integers, in halalas. A riyal is 100 halalas, every amount
 * here is an integer count of them, and nothing is ever a float.
 *
 * THE ROUNDING RULE, the only one: the commission is 7% of the gross in
 * halalas, rounded HALF UP to the nearest halala; the seller's share is the
 * exact remainder. So gross = commission + seller share holds to the halala
 * by construction, for every amount, and nothing is rounded twice.
 *
 *   100.00 SAR → 7.00 commission, 93.00 seller
 *    99.00 SAR → 6.93 commission, 92.07 seller
 *     1.00 SAR → 0.07 commission,  0.93 seller
 *     0.50 SAR → 0.04 commission,  0.46 seller   (3.5 halalas rounds up)
 *
 * A price with more than two decimals is not money SaiFlow stores (the
 * column is DECIMAL(10,2)), so it is refused, by the calculator and by both
 * product routes alike, rather than rounded by anyone.
 *
 * ONE MODULE FOR EVERYONE. The seller's live calculator, the Order snapshot
 * written at fulfilment, and the revenue views all call this. No caller
 * multiplies a price anywhere else.
 *
 * Framework-free and dependency-free, so it ships to the browser unchanged.
 */

/** 7.00%, in basis points. */
export const COMMISSION_RATE_BPS = 700;

/** Stamped on every Order snapshot, so a later rate change is visible per row. */
export const COMMISSION_VERSION = "2026-09-v1";

export const HALALAS_PER_RIYAL = 100;

/** The create route's ceiling, 100,000 SAR, in halalas. */
export const MAX_PRICE_HALALAS = 100_000 * HALALAS_PER_RIYAL;

export interface SaleSplit {
  grossHalalas: number;
  commissionHalalas: number;
  sellerNetHalalas: number;
  rateBps: number;
  version: string;
}

/** Plain decimal only: digits, optionally a point and more digits. No sign, no exponent, no separators. */
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** The largest halala count downstream integer arithmetic can carry exactly. */
const MAX_HALALAS = Math.floor(Number.MAX_SAFE_INTEGER / 10_000);

function assertHalalas(value: number, what = "amount"): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_HALALAS) {
    throw new RangeError(`${what} must be a non-negative integer count of halalas`);
  }
}

/**
 * TWO PARSERS, ONE CONCEPT EACH.
 *
 * `parseMoney` reads an amount that already exists: a stored Order snapshot,
 * a database SUM, an attempt's paid amount. It has no ceiling, because a sum
 * of many sales is as large as it is; it is BigInt-safe; and it refuses
 * anything that is not a plain non-negative decimal with at most two
 * places, because stored money is exact and a third decimal is corruption,
 * not something to round.
 *
 * `parsePrice` reads what a seller is asking for. It is `parseMoney` plus
 * the product-price ceiling, and is the ONLY parser that knows the ceiling.
 * Create, edit and the live calculator use it, so the three cannot disagree.
 *
 * Neither ever turns an unreadable value into zero. Null means "not money";
 * the caller decides what that means where it stands.
 */
export function parseMoney(amount: unknown): number | null {
  if (amount === null || amount === undefined || typeof amount === "boolean") return null;
  if (typeof amount === "number" && !Number.isFinite(amount)) return null;
  if (typeof amount === "object" && typeof (amount as { toString?: unknown }).toString !== "function") return null;
  const text = typeof amount === "string" ? amount.trim() : String(amount);
  const match = DECIMAL.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > 2) return null;
  const halalas = BigInt(match[1]) * BigInt(HALALAS_PER_RIYAL) + BigInt(fraction.padEnd(2, "0"));
  if (halalas > BigInt(MAX_HALALAS)) return null;
  return Number(halalas);
}

/** A seller's price: exact money, at most two decimals, within the product ceiling. */
export function parsePrice(input: unknown): number | null {
  const halalas = parseMoney(input);
  if (halalas === null || halalas > MAX_PRICE_HALALAS) return null;
  return halalas;
}

export type PriceProblem = "missing" | "malformed" | "precision" | "range";

export type PriceCheck =
  | { ok: true; halalas: number; price: string }
  | { ok: false; reason: PriceProblem };

/**
 * The one price validator for create and edit. Says WHY a price is refused,
 * so both routes answer with the same words for the same input.
 */
export function validatePrice(input: unknown): PriceCheck {
  if (input === null || input === undefined || (typeof input === "string" && input.trim() === "")) {
    return { ok: false, reason: "missing" };
  }
  if (typeof input === "number" && !Number.isFinite(input)) return { ok: false, reason: "malformed" };
  if (typeof input !== "number" && typeof input !== "string") return { ok: false, reason: "malformed" };
  const text = typeof input === "string" ? input.trim() : String(input);
  if (text.startsWith("-")) return { ok: false, reason: "range" };
  const match = DECIMAL.exec(text);
  if (!match) return { ok: false, reason: "malformed" };
  if ((match[2] ?? "").length > 2) return { ok: false, reason: "precision" };
  const halalas = parsePrice(text);
  if (halalas === null) return { ok: false, reason: "range" };
  return { ok: true, halalas, price: fromHalalas(halalas) };
}

/** The API's wording for a refused price, shared by create and edit. */
export function priceProblemMessage(reason: PriceProblem): string {
  switch (reason) {
    case "missing":
      return "Price is required";
    case "precision":
      return "Price must have at most two decimal places";
    case "range":
      return "Price must be between 0 and 100,000 SAR";
    case "malformed":
      return "Price must be a valid amount in SAR";
  }
}

/** A two-decimal string, e.g. 9307 → "93.07". What the database and the API carry. */
export function fromHalalas(halalas: number): string {
  assertHalalas(halalas);
  const whole = Math.floor(halalas / HALALAS_PER_RIYAL);
  const cents = halalas % HALALAS_PER_RIYAL;
  return `${whole}.${String(cents).padStart(2, "0")}`;
}

/** For DISPLAY only, through a currency formatter. Never for arithmetic. */
export function halalasToNumber(halalas: number): number {
  assertHalalas(halalas);
  return halalas / HALALAS_PER_RIYAL;
}

/** The split of one sale. Integer in, integers out, and the sum holds exactly. */
export function splitSale(grossHalalas: number, rateBps: number = COMMISSION_RATE_BPS): SaleSplit {
  assertHalalas(grossHalalas, "gross");
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new RangeError("rate must be an integer number of basis points between 0 and 10000");
  }
  // gross × rate / 10000, rounded half up, without leaving the integers.
  const commissionHalalas = Math.floor((grossHalalas * rateBps + 5_000) / 10_000);
  return {
    grossHalalas,
    commissionHalalas,
    sellerNetHalalas: grossHalalas - commissionHalalas,
    rateBps,
    version: COMMISSION_VERSION,
  };
}

/** A seller's price, split for the calculator. Null when the input is not a valid price. */
export function priceBreakdown(input: unknown): SaleSplit | null {
  const halalas = parsePrice(input);
  return halalas === null ? null : splitSale(halalas);
}

/** A stored or paid amount, split for the Order snapshot. Null when it is not money. */
export function saleBreakdown(amount: unknown): SaleSplit | null {
  const halalas = parseMoney(amount);
  return halalas === null ? null : splitSale(halalas);
}

/** "7%" for 700 bps, "7.5%" for 750, for labels. */
export function commissionPercentLabel(rateBps: number = COMMISSION_RATE_BPS): string {
  const whole = Math.floor(rateBps / 100);
  const rest = rateBps % 100;
  if (rest === 0) return `${whole}%`;
  return `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}%`;
}

/**
 * Sum stored amounts exactly. Nothing unreadable is coerced to zero: it is
 * left out of the total and COUNTED, so the caller can say so.
 */
export function sumMoney(amounts: Iterable<unknown>): { halalas: number; unreadable: number } {
  let halalas = 0;
  let unreadable = 0;
  for (const amount of amounts) {
    const value = parseMoney(amount);
    if (value === null) unreadable++;
    else halalas += value;
  }
  assertHalalas(halalas, "total");
  return { halalas, unreadable };
}
