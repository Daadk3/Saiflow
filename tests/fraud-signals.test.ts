/**
 * Warning signs of a fraudulent sale (lib/fraud-signals).
 *
 * What must hold:
 * - The same mailbox written differently (case, a "+tag", Gmail dots or the
 *   googlemail domain) is recognised as the same buyer; different mailboxes
 *   never are.
 * - The payout warnings are counts only, and a repeat buyer is flagged only
 *   at REPEAT_BUYER_THRESHOLD orders or more.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { REPEAT_BUYER_THRESHOLD, canonicalEmail, isShopMemberEmail, payoutWarnings } from "../lib/fraud-signals.ts";

describe("one mailbox, however it is written", () => {
  test("case, spaces and +tags", () => {
    assert.equal(canonicalEmail("  Seller+Test@Example.COM "), "seller@example.com");
    assert.equal(canonicalEmail("seller@example.com"), "seller@example.com");
  });

  test("Gmail ignores dots and answers to googlemail.com", () => {
    assert.equal(canonicalEmail("My.Shop@gmail.com"), "myshop@gmail.com");
    assert.equal(canonicalEmail("m.y.shop+x@googlemail.com"), "myshop@gmail.com");
  });

  test("dots matter everywhere else, and odd shapes are left alone", () => {
    assert.notEqual(canonicalEmail("my.shop@outlook.com"), canonicalEmail("myshop@outlook.com"));
    assert.equal(canonicalEmail("+only@example.com"), "+only@example.com", "a name that is all tag is kept");
    assert.equal(canonicalEmail("no-at-sign"), "no-at-sign");
  });

  test("a shop member is recognised; anyone else is not", () => {
    const members = ["Owner@Example.com", "my.helper@gmail.com"];
    assert.equal(isShopMemberEmail("owner+buy@example.com", members), true);
    assert.equal(isShopMemberEmail("myhelper@gmail.com", members), true);
    assert.equal(isShopMemberEmail("owner@example.org", members), false);
    assert.equal(isShopMemberEmail("buyer@example.com", members), false);
    assert.equal(isShopMemberEmail("buyer@example.com", []), false);
  });
});

describe("the warnings beside a payout", () => {
  const order = (customerEmail: string) => ({ customerEmail });

  test("orders from the shop's own team are counted", () => {
    const warnings = payoutWarnings([order("owner+1@example.com"), order("buyer@example.com")], ["owner@example.com"]);
    assert.deepEqual(warnings, { ownShopOrders: 1, repeatBuyerOrders: 0 });
  });

  test("a repeat buyer is flagged at the threshold, not below it", () => {
    assert.equal(REPEAT_BUYER_THRESHOLD, 3);
    const twice = [order("fan@example.com"), order("Fan@example.com")];
    assert.equal(payoutWarnings(twice, []).repeatBuyerOrders, 0);
    const thrice = [...twice, order("fan+again@example.com"), order("other@example.com")];
    assert.equal(payoutWarnings(thrice, []).repeatBuyerOrders, 3, "every order from that buyer, and only theirs");
  });

  test("nothing to warn about", () => {
    assert.deepEqual(payoutWarnings([], ["owner@example.com"]), { ownShopOrders: 0, repeatBuyerOrders: 0 });
  });
});
