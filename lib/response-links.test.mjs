import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./response-links.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { splitResponseLinks, labelResponseLink } = compiledModule.exports;

test("bare URLs move out of the answer into labelled links", () => {
  const { body, links } = splitResponseLinks("반영했습니다. 변경 내용: https://github.com/jaywapp/gyungchung/pull/161\n다음 주부터 적용됩니다.");
  assert.equal(body, "반영했습니다. 변경 내용\n다음 주부터 적용됩니다.");
  assert.deepEqual(links, [{ url: "https://github.com/jaywapp/gyungchung/pull/161", label: "GitHub PR #161" }]);
});

test("trailing punctuation and wrapping brackets stay out of the link", () => {
  const { body, links } = splitResponseLinks("이슈로 등록했습니다(https://github.com/jaywapp/gyungchung/issues/157).");
  assert.equal(body, "이슈로 등록했습니다.");
  assert.equal(links[0].url, "https://github.com/jaywapp/gyungchung/issues/157");
  assert.equal(links[0].label, "GitHub Issue #157");
});

test("markdown links keep their words and repeated URLs become one badge", () => {
  const { body, links } = splitResponseLinks("[배포 기록](https://gyungchung.vercel.app/updates)을 확인해 주세요. https://gyungchung.vercel.app/updates");
  assert.equal(body, "배포 기록을 확인해 주세요.");
  assert.equal(links.length, 1);
  assert.equal(links[0].label, "gyungchung.vercel.app/updates");
});

test("answers without links pass through untouched", () => {
  const text = "다음 운영 회의에서 논의하겠습니다.\n\n감사합니다.";
  assert.deepEqual(splitResponseLinks(text), { body: text, links: [] });
});

test("long non-GitHub links are shortened for the badge", () => {
  assert.match(labelResponseLink("https://example.com/a/very/long/path/that/keeps/going/on/and/on"), /…$/);
});
