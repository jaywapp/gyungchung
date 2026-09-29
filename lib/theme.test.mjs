import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./theme.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { parseThemePreference, resolveTheme, themeInitScript, THEME_STORAGE_KEY } = compiledModule.exports;

test("unknown or missing stored values fall back to the system preference", () => {
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(parseThemePreference(null), "system");
  assert.equal(parseThemePreference("sepia"), "system");
});

test("system follows the OS while explicit choices override it", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("the pre-paint script resolves the theme the same way", () => {
  const run = (stored, prefersDark) => {
    const documentElement = { dataset: {} };
    const context = {
      localStorage: { getItem: (key) => (key === THEME_STORAGE_KEY ? stored : null) },
      window: { matchMedia: () => ({ matches: prefersDark }) },
      document: { documentElement },
    };
    new Function("localStorage", "window", "document", themeInitScript)(context.localStorage, context.window, context.document);
    return documentElement.dataset.theme;
  };
  assert.equal(run(null, true), "dark");
  assert.equal(run(null, false), "light");
  assert.equal(run("light", true), "light");
  assert.equal(run("dark", false), "dark");
});
