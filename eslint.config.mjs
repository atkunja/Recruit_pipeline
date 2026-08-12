import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships real flat configs, so they are imported directly.
 * Going through FlatCompat instead throws "Converting circular structure to
 * JSON" when it tries to validate the already-flat plugin objects.
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "local-artifacts/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // We use `any` at a couple of untyped third-party boundaries and narrow
      // immediately; everywhere else it should be flagged.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default eslintConfig;
