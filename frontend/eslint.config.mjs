import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Environment variables are read and validated only inside src/lib/env/.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/env/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            "Do not read process.env directly: import from @/lib/env/server or @/lib/env/client.",
        },
      ],
    },
  },
  // Must come last: turns off rules that conflict with Prettier.
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);
