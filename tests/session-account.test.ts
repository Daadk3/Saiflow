/**
 * Ownership by account id (lib/session-account) and no caching of API answers.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { sessionUserId } from "../lib/session-account.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("the signed-in account's id", () => {
  test("read from the session, or null", () => {
    assert.equal(sessionUserId({ user: { id: "cm123", email: "a@b.test" } }), "cm123");
    for (const bad of [null, undefined, {}, { user: {} }, { user: { id: "" } }, { user: { id: 7 } }, { user: { email: "a@b.test" } }]) {
      assert.equal(sessionUserId(bad), null, JSON.stringify(bad));
    }
  });

  test("the shop routes decide membership by it, never by comparing emails", () => {
    const slug = read("app/api/shops/[slug]/route.ts");
    assert.equal((slug.match(/\(su\) => userId !== null && su\.userId === userId/g) ?? []).length, 2, "GET and PUT");
    assert.ok(!/su\.user\.email ===/.test(slug));
    const list = read("app/api/shops/route.ts");
    assert.ok(list.includes("where: { id: userId },"));
    assert.ok(!list.includes("where: { email: session.user.email }"), "the old exact-case lookup is gone");
  });
});

describe("API answers are never cached", () => {
  test("in the app's own config as well as Vercel's", () => {
    assert.match(read("next.config.ts"), /source: "\/api\/\(\.\*\)", headers: \[\{ key: "Cache-Control", value: "no-store, must-revalidate" \}\]/);
    const vercel = JSON.parse(read("vercel.json"));
    const api = vercel.headers.find((h: { source: string }) => h.source === "/api/(.*)");
    assert.deepEqual(api.headers, [{ key: "Cache-Control", value: "no-store, must-revalidate" }]);
  });
});
