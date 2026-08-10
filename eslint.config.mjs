import { defineConfig, globalIgnores } from "eslint/config";
import reactRefresh from "eslint-plugin-react-refresh";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default defineConfig([globalIgnores(["**/dist", "**/.eslintrc.cjs"]), {
    extends: [
        js.configs.recommended,
        ...tseslint.configs.recommended,
        reactHooks.configs.flat["recommended-latest"],
    ],

    plugins: {
        "react-refresh": reactRefresh,
    },

    languageOptions: {
        sourceType: "module",
        globals: {
            ...globals.browser,
        },
    },

    rules: {
        'react-refresh/only-export-components': ['warn', {
            allowConstantExport: true,
        }],
        'no-useless-escape': 0,
    },
}, {
  files: ['**/*.js'],
  languageOptions: {
    sourceType: 'commonjs',
    globals: { ...globals.node }
  },
  rules: {
    semi: ['error', 'always']
  }
}, {
  // Build/tooling scripts run in Node, not the browser.
  files: ['scripts/**/*.mjs'],
  languageOptions: {
    sourceType: 'module',
    globals: { ...globals.node }
  },
}]);