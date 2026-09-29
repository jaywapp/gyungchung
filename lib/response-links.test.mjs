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
  assert.equal(body, "반영했습니다.\n다음 주부터 적용됩니다.");
  assert.deepEqual(links, [{ url: "https://github.com/jaywapp/gyungchung/pull/161", label: "GitHub PR #161" }]);
});

test("captioned links chained with a separator leave no fragments behind", () => {
  const { body, links } = splitResponseLinks("일정 자동 갱신 활성화를 확인했습니다. 운영 배포 확인: https://gyungchung.vercel.app/events · PR: https://github.com/jaywapp/gyungchung/pull/161");
  assert.equal(body, "일정 자동 갱신 활성화를 확인했습니다.");
  assert.deepEqual(links, [
    { url: "https://gyungchung.vercel.app/events", label: "운영 배포 확인" },
    { url: "https://github.com/jaywapp/gyungchung/pull/161", label: "GitHub PR #161" },
  ]);
});

test("pipe and comma separators between captioned links are removed too", () => {
  const { body, links } = splitResponseLinks("완료했습니다.\n배포: https://gyungchung.vercel.app/ | 이슈: https://github.com/jaywapp/gyungchung/issues/160, 문서: https://example.com/guide");
  assert.equal(body, "완료했습니다.");
  assert.deepEqual(links.map((link) => link.label), ["배포", "GitHub Issue #160", "문서"]);
});

test("prose before a link is only a caption when it is short and ends in a colon", () => {
  const plain = splitResponseLinks("자세한 변경 사항은 https://example.com/notes 에서 확인해 주세요.");
  assert.equal(plain.body, "자세한 변경 사항은 에서 확인해 주세요.");
  assert.equal(plain.links[0].label, "example.com/notes");
  const long = splitResponseLinks("이번 배포에서 확인한 운영 사이트의 새 일정 화면 주소는 다음과 같습니다: https://gyungchung.vercel.app/events");
  assert.equal(long.body, "이번 배포에서 확인한 운영 사이트의 새 일정 화면 주소는 다음과 같습니다");
  assert.equal(long.links[0].label, "gyungchung.vercel.app/events");
});

test("answers written as a line-broken list without links stay exactly as stored", () => {
  const text = "운영 배포를 완료했습니다.\n- `20260929082403_weekly_schedule_and_awards` 마이그레이션 적용\n- 일정 자동 갱신 확인";
  assert.deepEqual(splitResponseLinks(text), { body: text, links: [] });
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
