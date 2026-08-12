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

  return nextResolve(specifier, context);
}
