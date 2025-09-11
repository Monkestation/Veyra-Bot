import js from "@eslint/js";
import globals from "globals";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import { defineConfig } from "eslint/config";
import { readFileSync } from "node:fs";
export default defineConfig([
  {
    ignores: 
      // HOLY SHIT DUDE I LOVE THIS SO MUCH!
      readFileSync(".eslintignore", { encoding: "utf8" }).trim().split(/\r?\n/),
    
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    },
    languageOptions: { globals: globals.node },
    extends: ["js/recommended"],
  },
  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "commonjs" },
  },
  {
    files: ["**/*.json"],
    plugins: { json },
    language: "json/json",
    rules: json.configs.recommended.rules,
  },
  {
    files: ["**/*.md"],
    plugins: { markdown },
    language: "markdown/gfm",
    rules: Object.assign(
      {},
      ...markdown.configs.recommended.flatMap((e) => e.rules)
    ),
  },
]);
