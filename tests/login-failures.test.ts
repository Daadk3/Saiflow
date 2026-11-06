/**
 * Failed sign-ins are limited per account (lib/rate-limit loginFailures):
 * 10 per account and address, 100 per account from anywhere, in 15 minutes.
 * Only failures are recorded (app/api/auth/authOptions; pinned in
 * tests/security-auth-access). The real limiter, no stand-ins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loginFailures } from "../lib/rate-limit.ts";

  test("failed sign-ins: 10 per account and address, 100 per account, only failures count", () => {
    const email = `limit-${Date.now()}@example.com`;
    for (let i = 0; i < 10; i++) {
      assert.equal(loginFailures.blocked(email, "10.1.1.1"), false, `before failure ${i + 1}`);
      loginFailures.record(email, "10.1.1.1");
    }
    assert.equal(loginFailures.blocked(email, "10.1.1.1"), true, "that address is stopped");
    assert.equal(loginFailures.blocked(email, "10.2.2.2"), false, "another address is not");
    assert.equal(loginFailures.blocked(email.toUpperCase(), "10.1.1.1"), true, "case does not matter");
    for (let i = 0; i < 90; i++) loginFailures.record(email, `10.3.${i >> 8}.${i & 255}`);
    assert.equal(loginFailures.blocked(email, "10.9.9.9"), true, "a hundred failures from anywhere stop every address");
    assert.equal(loginFailures.blocked(`other-${Date.now()}@example.com`, "10.1.1.1"), false, "other accounts are untouched");
  });

