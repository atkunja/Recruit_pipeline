import { register } from "node:module";

// Installs the extension-retry resolver in ./loader-hooks.mjs for the test run.
register("./loader-hooks.mjs", import.meta.url);
