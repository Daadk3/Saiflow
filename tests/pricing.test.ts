/**
 * lib/pricing — the one place SaiFlow's commission is computed.
 *
 * Integers in halalas, one rounding rule (half up to the halala), and the
 * invariant gross = commission + seller share for every amount. Behavioural.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  COMMISSION_RATE_BPS,
  COMMISSION_VERSION,
  MAX_PRICE_HALALAS,
  commissionPercentLabel,
  fromHalalas,
  halalasToNumber,
  parseMoney,
  parsePrice,
  priceBreakdown,
  priceProblemMessage,
  saleBreakdown,
  splitSale,
  sumMoney,
  validatePrice,
} from "../lib/pricing";

/** Independent oracle in BigInt: 7% of the gross, half up, no floats anywhere. */
const oracle = (gross: number) => Number((BigInt(gross) * BigInt(700) + BigInt(5_000)) / BigInt(10_000));

describe("the approved rule", () => {
  test("7% of the sale price, the seller keeps the rest", () => {
    assert.equal(COMMISSION_RATE_BPS, 700);
    assert.ok(COMMISSION_VERSION.length > 0);
    const split = saleBreakdown("100")!;
    assert.deepEqual(split, { grossHalalas: 10_000, commissionHalalas: 700, sellerNetHalalas: 9_300, rateBps: 700, version: COMMISSION_VERSION });
    assert.equal(fromHalalas(split.commissionHalalas), "7.00");
    assert.equal(fromHalalas(split.sellerNetHalalas), "93.00");
  });

  test("the requested amounts, exactly", () => {
    const cases: Array<[string, string, string, string]> = [
      ["1", "1.00", "0.07", "0.93"],
      ["10", "10.00", "0.70", "9.30"],
      ["99", "99.00", "6.93", "92.07"],
      ["100", "100.00", "7.00", "93.00"],
      ["0.01", "0.01", "0.00", "0.01"],
      ["0.07", "0.07", "0.00", "0.07"],
      ["0.08", "0.08", "0.01", "0.07"],
      ["0.50", "0.50", "0.04", "0.46"],
      ["12.34", "12.34", "0.86", "11.48"],
      ["99.99", "99.99", "7.00", "92.99"],
      ["1234.56", "1234.56", "86.42", "1148.14"],
      ["100000", "100000.00", "7000.00", "93000.00"],
    ];
    for (const [input, gross, commission, net] of cases) {
      const split = saleBreakdown(input);
      assert.ok(split, input);
      assert.equal(fromHalalas(split.grossHalalas), gross, `${input} gross`);
      assert.equal(fromHalalas(split.commissionHalalas), commission, `${input} commission`);
      assert.equal(fromHalalas(split.sellerNetHalalas), net, `${input} net`);
    }
  });

  test("rounding at halala boundaries: exactly half a halala rounds up, just under rounds down", () => {
    // gross × 7 ends in 50 → x.5 halalas → up.
    for (const gross of [50, 150, 250, 350, 1_050, 9_950]) {
      const split = splitSale(gross);
      assert.equal(split.commissionHalalas, Math.floor((gross * 7) / 100) + 1, `${gross} half up`);
    }
    // gross × 7 ends in 49 or less → down.
    for (const gross of [49, 149, 7, 21]) {
      const split = splitSale(gross);
      assert.equal(split.commissionHalalas, Math.floor((gross * 7) / 100), `${gross} down`);
    }
    assert.equal(splitSale(50).commissionHalalas, 4);
    assert.equal(splitSale(50).sellerNetHalalas, 46);
  });

  test("gross = commission + seller share, and the commission matches an integer oracle, for every halala up to 2,000 SAR", () => {
    for (let gross = 0; gross <= 200_000; gross++) {
      const split = splitSale(gross);
      assert.equal(split.commissionHalalas + split.sellerNetHalalas, gross);
      assert.equal(split.commissionHalalas, oracle(gross));
      assert.ok(split.sellerNetHalalas >= 0);
    }
  });

  test("the invariant holds at the ceiling and at scattered large amounts", () => {
    for (const gross of [MAX_PRICE_HALALAS, 9_999_999, 1_234_567, 7_777_777, 5_000_050]) {
      const split = splitSale(gross);
      assert.equal(split.commissionHalalas + split.sellerNetHalalas, gross);
      assert.equal(split.commissionHalalas, oracle(gross));
    }
  });
});

describe("two parsers: a seller's price, and money that already exists", () => {
  test("parseMoney reads decimal strings, numbers and Decimal-like objects exactly, without floats", () => {
    assert.equal(parseMoney("25"), 2_500);
    assert.equal(parseMoney("25.5"), 2_550);
    assert.equal(parseMoney("25.50"), 2_550);
    assert.equal(parseMoney("  25.05  "), 2_505);
    assert.equal(parseMoney(25), 2_500);
    assert.equal(parseMoney({ toString: () => "25.00" }), 2_500, "a Prisma Decimal stringifies to a decimal");
    assert.equal(parseMoney("0"), 0);
    assert.equal(parseMoney(0), 0);
  });

  test("parseMoney has no product ceiling: stored snapshots and database sums above 100,000 SAR read exactly", () => {
    assert.equal(parseMoney("100000.01"), 10_000_001);
    assert.equal(parseMoney("150000"), 15_000_000);
    assert.equal(parseMoney("150000.00"), 15_000_000);
    assert.equal(parseMoney("1000000"), 100_000_000);
    assert.equal(parseMoney("1000000.00"), 100_000_000);
    assert.equal(parseMoney("99999999.99"), 9_999_999_999);
    assert.equal(fromHalalas(parseMoney("1000000")!), "1000000.00");
    assert.equal(parseMoney({ toString: () => "1234567.5" }), 123_456_750, "a Decimal sum with one place");
  });

  test("parseMoney is BigInt-safe and refuses what integer arithmetic could not carry exactly", () => {
    // The safe bound is floor(MAX_SAFE_INTEGER / 10000) halalas = 9,007,199,254.74 SAR.
    assert.equal(parseMoney("9007199254.74"), 900_719_925_474, "just under the safe bound");
    assert.equal(parseMoney("9007199254.75"), null, "just over it: null, never an inexact number");
    assert.equal(parseMoney("123456789012345678901234567890"), null);
  });

  test("parseMoney refuses anything that is not exact money: sign, exponent, separators, a third decimal, non-numbers", () => {
    for (const bad of ["", "   ", "-1", "+1", "1e3", "abc", "1,000", "١٠", "10.", ".5", "10.005", "0.995", null, undefined, NaN, Infinity, -0.01, "0x10", true, false, [], {}, Symbol("x")]) {
      assert.equal(parseMoney(bad), null, String(bad));
    }
  });

  test("parsePrice is parseMoney plus the ceiling, and nothing else", () => {
    assert.equal(parsePrice("100000"), MAX_PRICE_HALALAS);
    assert.equal(parsePrice("100000.00"), MAX_PRICE_HALALAS);
    assert.equal(parsePrice("100000.01"), null, "one halala over the ceiling");
    assert.equal(parsePrice("150000"), null);
    assert.equal(parsePrice("10.005"), null, "a third decimal is refused, not rounded");
    assert.equal(parsePrice("10.50"), 1_050);
    assert.equal(parsePrice(0), 0);
    assert.equal(parsePrice("-1"), null);
  });

  test("validatePrice says why, with the same words for create and edit", () => {
    assert.deepEqual(validatePrice("12.34"), { ok: true, halalas: 1_234, price: "12.34" });
    assert.deepEqual(validatePrice(10.5), { ok: true, halalas: 1_050, price: "10.50" });
    assert.deepEqual(validatePrice(100000), { ok: true, halalas: MAX_PRICE_HALALAS, price: "100000.00" });
    assert.deepEqual(validatePrice(0), { ok: true, halalas: 0, price: "0.00" });
    assert.deepEqual(validatePrice(undefined), { ok: false, reason: "missing" });
    assert.deepEqual(validatePrice(null), { ok: false, reason: "missing" });
    assert.deepEqual(validatePrice(""), { ok: false, reason: "missing" });
    assert.deepEqual(validatePrice(-1), { ok: false, reason: "range" });
    assert.deepEqual(validatePrice("-0.01"), { ok: false, reason: "range" });
    assert.deepEqual(validatePrice(100000.01), { ok: false, reason: "range" });
    assert.deepEqual(validatePrice("150000"), { ok: false, reason: "range" });
    assert.deepEqual(validatePrice(10.005), { ok: false, reason: "precision" });
    assert.deepEqual(validatePrice("1.234"), { ok: false, reason: "precision" });
    for (const bad of [NaN, Infinity, -Infinity, "abc", "1e3", "1,000", "10.", ".5", true, [], {}]) {
      // -Infinity is not a number SaiFlow can range-check; it is malformed like NaN.
      assert.deepEqual(validatePrice(bad), { ok: false, reason: typeof bad === "string" && bad.startsWith("-") ? "range" : "malformed" }, String(bad));
    }
    assert.equal(priceProblemMessage("range"), "Price must be between 0 and 100,000 SAR");
    assert.equal(priceProblemMessage("precision"), "Price must have at most two decimal places");
    assert.ok(priceProblemMessage("missing").length > 0 && priceProblemMessage("malformed").length > 0);
  });

  test("priceBreakdown is for the calculator (ceiling applies); saleBreakdown is for stored amounts (it does not)", () => {
    assert.equal(priceBreakdown("150000"), null);
    assert.equal(priceBreakdown("10.005"), null);
    assert.deepEqual(priceBreakdown("100")!.commissionHalalas, 700);
    const big = saleBreakdown("150000")!;
    assert.deepEqual([fromHalalas(big.grossHalalas), fromHalalas(big.commissionHalalas), fromHalalas(big.sellerNetHalalas)], ["150000.00", "10500.00", "139500.00"]);
    const huge = saleBreakdown("1000000")!;
    assert.deepEqual([fromHalalas(huge.commissionHalalas), fromHalalas(huge.sellerNetHalalas)], ["70000.00", "930000.00"]);
    assert.equal(saleBreakdown("10.005"), null, "stored money with a third decimal is corruption, not a price");
  });

  test("formatting back is exact and two-decimal", () => {
    assert.equal(fromHalalas(0), "0.00");
    assert.equal(fromHalalas(7), "0.07");
    assert.equal(fromHalalas(9_307), "93.07");
    assert.equal(fromHalalas(10_000), "100.00");
    assert.equal(fromHalalas(MAX_PRICE_HALALAS), "100000.00");
    assert.throws(() => fromHalalas(1.5), RangeError);
    assert.throws(() => fromHalalas(-1), RangeError);
    assert.equal(halalasToNumber(9_307), 93.07);
  });

  test("round trips: parseMoney(fromHalalas(h)) === h for every halala up to 1,000 SAR", () => {
    for (let h = 0; h <= 100_000; h++) assert.equal(parseMoney(fromHalalas(h)), h);
  });

  test("sumMoney adds exactly, counts what it could not read, and never coerces it to zero", () => {
    assert.deepEqual(sumMoney(["0.10", "0.20", 0.3]), { halalas: 60, unreadable: 0 });
    assert.deepEqual(sumMoney(["0.10", "abc", null, "0.20"]), { halalas: 30, unreadable: 2 });
    assert.deepEqual(sumMoney([]), { halalas: 0, unreadable: 0 });
    // Many orders above the product ceiling in total.
    const gross = sumMoney(["100000.00", "100000.00", "100000.00"]);
    assert.deepEqual(gross, { halalas: 30_000_000, unreadable: 0 });
    assert.equal(fromHalalas(gross.halalas), "300000.00");
    const commission = sumMoney(["7000.00", "7000.00", "7000.00"]);
    const net = sumMoney(["93000.00", "93000.00", "93000.00"]);
    assert.equal(fromHalalas(commission.halalas), "21000.00");
    assert.equal(fromHalalas(net.halalas), "279000.00");
    assert.equal(commission.halalas + net.halalas, gross.halalas);
  });

  test("the rate is validated and the label reads as people write percentages", () => {
    assert.throws(() => splitSale(100, 10_001), RangeError);
    assert.throws(() => splitSale(100, -1), RangeError);
    assert.throws(() => splitSale(100, 7.5), RangeError);
    assert.throws(() => splitSale(-1), RangeError);
    assert.throws(() => splitSale(1.5), RangeError);
    assert.equal(commissionPercentLabel(), "7%");
    assert.equal(commissionPercentLabel(750), "7.5%");
    assert.equal(commissionPercentLabel(725), "7.25%");
    assert.equal(commissionPercentLabel(0), "0%");
  });
});
