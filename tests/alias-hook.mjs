/**
 * Resolves the project's `@/*` TypeScript path alias for Node's test runner.
 *
 * tsconfig maps `@/*` to the repository root, but that alias is a
 * TypeScript/bundler concept Node knows nothing about. This hook teaches the
 * ESM loader the same mapping so tests can import application modules exactly
 * as the app does — no source changes, no test-only import conventions and no
 * new dependency.
 */
import { pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = resolvePath(ROOT, specifier.slice(2));
    // Try the literal path first, then the TypeScript extensions the repo uses.
    for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`]) {
      try {
        return await nextResolve(pathToFileURL(candidate).href, context);
      } catch {
        // try the next candidate
      }
    }
  }
  return nextResolve(specifier, context);
}
