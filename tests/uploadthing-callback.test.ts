/**
 * UploadThing confirmations reach a protected Preview only through the TEST
 * relay; Production and local development keep UploadThing's default.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_UPLOAD_CALLBACK_RELAY_URL, uploadthingCallbackConfig } from "../lib/uploadthing-callback.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("where UploadThing confirmations go", () => {
  test("a Preview names the fixed relay endpoint", () => {
    assert.deepEqual(uploadthingCallbackConfig({ VERCEL_ENV: "preview" }), {
      callbackUrl: "https://project-w5bhm.vercel.app/api/uploadthing-callback",
    });
    assert.equal(TEST_UPLOAD_CALLBACK_RELAY_URL, "https://project-w5bhm.vercel.app/api/uploadthing-callback");
  });

  test("Production and local development set nothing, so UploadThing keeps its default", () => {
    for (const env of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, {}, { VERCEL_ENV: "Preview" }]) {
      assert.deepEqual(uploadthingCallbackConfig(env), {}, JSON.stringify(env));
      assert.ok(!("callbackUrl" in uploadthingCallbackConfig(env)), "no key at all, not an undefined one");
    }
  });

  test("the route handler takes its config from this function only", () => {
    const route = strip(read("app/api/uploadthing/route.ts"));
    assert.match(route, /createRouteHandler\(\{\s*router: ourFileRouter,\s*config: uploadthingCallbackConfig\(\),\s*\}\)/);
    assert.ok(!/req(uest)?\.|headers/.test(route), "nothing from a request chooses the callback");
  });

  test("the choice reads VERCEL_ENV only, never a header or a configurable URL", () => {
    const src = strip(read("lib/uploadthing-callback.ts"));
    assert.ok(!/headers|request|NEXTAUTH_URL|VERCEL_URL|UPLOADTHING_CALLBACK/.test(src));
    assert.equal(src.split("TEST_UPLOAD_CALLBACK_RELAY_URL").length - 1, 2, "defined once, used once");
  });
});
