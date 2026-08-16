/**
 * Teaches Node's test runner the two module-resolution conventions the app
 * relies on but the plain ESM resolver does not implement.
 *
 * 1. The `@/*` TypeScript path alias, which tsconfig maps to the repo root.
 * 2. Extensionless relative imports (`./archive`), which TypeScript and the
 *    Next.js bundler resolve to `.ts`/`.tsx` but Node does not.
 *
 * Both exist so tests can import application modules exactly as the app does —
 * no source changes, no test-only import conventions, no new dependency.
 */
import { pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

/** Candidate paths for a base path, in TypeScript's own resolution order. */
const candidates = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`];

async function tryCandidates(base, context, nextResolve) {
  for (const candidate of candidates(base)) {
    try {
      return await nextResolve(pathToFileURL(candidate).href, context);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = await tryCandidates(
      resolvePath(ROOT, specifier.slice(2)),
      context,
      nextResolve
    );
    if (resolved) return resolved;
  }

  // Relative specifier with no extension, resolved against the importing file.
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[a-z]+$/i.test(specifier) &&
    context.parentURL?.startsWith("file:")
  ) {
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const resolved = await tryCandidates(base, context, nextResolve);
    if (resolved) return resolved;
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    /**
     * A bare package subpath that resolves only with an explicit extension.
     *
     * `next/server` is the case that matters: Next ships no `exports` map, so
     * Node's ESM resolver will not append `.js` the way the bundler does, and
     * importing a route handler fails before a single assertion can run.
     * Retrying once with the extension is what the bundler would have done.
     *
     * Deliberately narrow — relative and aliased specifiers are handled above,
     * and the original error is rethrown when the retry also fails, so a
     * genuinely missing module still reports as missing.
     */
    if (
      error?.code === "ERR_MODULE_NOT_FOUND" &&
      !specifier.startsWith(".") &&
      !specifier.startsWith("@/") &&
      !specifier.startsWith("node:") &&
      specifier.includes("/") &&
      !/\.[a-z]+$/i.test(specifier)
    ) {
      try {
        return await nextResolve(`${specifier}.js`, context);
      } catch {
        // fall through and report the original failure
      }
    }
    throw error;
  }
}
