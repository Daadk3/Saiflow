/**
 * PRE_LAUNCH_MODE is on unless exactly "false", even when validation is
 * skipped (lib/env). With SKIP_ENV_VALIDATION the env library hands its raw
 * values through; an unset string used to read as off. Each case loads
 * lib/env afresh in its own process, with only the variables it names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function preLaunchWith(vars: Record<string, string>): unknown {
  const out = execFileSync(
    process.execPath,
    ["--import", "./tests/register.mjs", "--input-type=module", "-e", 'const { env } = await import("./lib/env.ts"); process.stdout.write(JSON.stringify(env.PRE_LAUNCH_MODE));'],
    {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
        NEXTAUTH_SECRET: "test-only",
        UPLOADTHING_TOKEN: "test-only",
        RESEND_API_KEY: "re_test_only",
        ...vars,
      },
      encoding: "utf8",
    }
  );
  return JSON.parse(out);
}

test("validated: on unless exactly \"false\"", () => {
  assert.equal(preLaunchWith({}), true);
  assert.equal(preLaunchWith({ PRE_LAUNCH_MODE: "true" }), true);
  assert.equal(preLaunchWith({ PRE_LAUNCH_MODE: "FALSE" }), true);
  assert.equal(preLaunchWith({ PRE_LAUNCH_MODE: "false" }), false);
});

test("validation skipped: still on unless exactly \"false\"", () => {
  assert.equal(preLaunchWith({ SKIP_ENV_VALIDATION: "1" }), true, "unset");
  assert.equal(preLaunchWith({ SKIP_ENV_VALIDATION: "1", PRE_LAUNCH_MODE: "no" }), true);
  assert.equal(preLaunchWith({ SKIP_ENV_VALIDATION: "1", PRE_LAUNCH_MODE: "false" }), false);
});
