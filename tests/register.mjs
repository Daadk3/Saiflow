// Registers the @/ alias resolver for Node's test runner.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./alias-hook.mjs", pathToFileURL("./tests/"));
