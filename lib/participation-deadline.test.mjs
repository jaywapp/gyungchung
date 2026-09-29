import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./participation-deadline.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { isParticipationClosed, formatDeadline } = compiledModule.exports;

const now = new Date("2026-09-29T12:00:00+09:00").getTime();

test("a form past its deadline is closed even while its stored status is open", () => {
  assert.equal(isParticipationClosed({ status: "open", ends_at: "2026-09-08T23:59:00+09:00" }, now), true);
  assert.equal(isParticipationClosed({ status: "open", ends_at: "2026-10-08T23:59:00+09:00" }, now), false);
  assert.equal(isParticipationClosed({ status: "open", ends_at: null }, now), false);
  assert.equal(isParticipationClosed({ status: "closed", ends_at: "2026-10-08T23:59:00+09:00" }, now), true);
});

test("a past deadline says 마감 once instead of repeating it", () => {
  const label = formatDeadline("2026-09-08T23:59:00+09:00", now);
  assert.match(label, /마감됨$/);
  assert.equal(label.match(/마감/g).length, 1);
});

test("an upcoming deadline keeps its countdown", () => {
  assert.match(formatDeadline("2026-10-02T23:59:00+09:00", now), /마감 · D-4$/);
});
