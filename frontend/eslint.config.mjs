import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const PROCESS_ENV_MESSAGE =
  "Do not read process.env directly: import from @/lib/env/server or @/lib/env/client.";

// Where `process` is the source of a destructuring pattern: `const { env } = process`,
// `({ env } = process)` and `function f({ env } = process)`.
const PROCESS_DESTRUCTURING =
  ":matches(VariableDeclarator[init.name='process'], AssignmentExpression[right.name='process'], AssignmentPattern[right.name='process']) > ObjectPattern > Property";

const PROCESS_ENV_SELECTORS = [
  // process.env
  "MemberExpression[object.name='process'][computed=false][property.name='env']",
  // process["env"]
  "MemberExpression[object.name='process'][computed=true][property.value='env']",
  // const { env } = process  /  const { env: e } = process  /  const { env = {} } = process
  `${PROCESS_DESTRUCTURING}[computed=false][key.name='env']`,
  // const { "env": e } = process  /  const { ["env"]: e } = process
  `${PROCESS_DESTRUCTURING}[key.value='env']`,
];

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
        ...PROCESS_ENV_SELECTORS.map((selector) => ({ selector, message: PROCESS_ENV_MESSAGE })),
      ],
      // `import { env } from "node:process"` is the same read through the module API.
      "no-restricted-imports": [
        "error",
        {
          paths: ["process", "node:process"].map((name) => ({
            name,
            importNames: ["env"],
            message: PROCESS_ENV_MESSAGE,
          })),
        },
      ],
    },
  },
  // Must come last: turns off rules that conflict with Prettier.
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);
