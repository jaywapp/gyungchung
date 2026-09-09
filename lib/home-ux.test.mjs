import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AlertCircle, CalendarDays, ChevronRight, CircleDollarSign, LogOut, Megaphone, X, Youtube } from "lucide-react";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Render the actual source declarations without loading the application's auth client.
function loadFunctions(path, names, bindings = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(declarations.length, names.length);
  const output = ts.transpileModule(declarations.map((node) => node.getText(parsed)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  return new Function("require", "exports", ...Object.keys(bindings), `${output}; return {${names.join(",")}};`)(require, exports, ...Object.values(bindings));
}

const states = loadFunctions("../components/section-states.tsx", ["SectionSkeleton", "AccountConnectionNotice"]);
const { Home, UnlinkedAccountModal } = loadFunctions("../components/clubhouse.tsx", ["Home", "UnlinkedAccountModal"], {
  AlertCircle, CalendarDays, ChevronRight, CircleDollarSign, LogOut, Megaphone, X, Youtube,
  ...states, useDialogFocus: () => ({ current: null }),
});
const defaults = {
  feeStanding: null, goingCount: 0, memberCount: 0, user: { id: "test-member" }, profile: null,
  sessionPending: false, publicLoading: false, eventLoadError: false, noticeLoadError: false,
  feeLoadError: false, rsvpPending: false, onRetry() {}, onRetryFees() {}, onNavigate() {},
  onAttendance() {}, onLogin() {},
};
const renderHome = (props) => renderToStaticMarkup(createElement(Home, { ...defaults, ...props }));

test("loading never claims that events or membership fees are empty", () => {
  const html = renderHome({ publicLoading: true, sessionPending: true });
  assert.match(html, /참석 일정을 불러오는 중/);
  assert.match(html, /회비 정보를 불러오는 중/);
  assert.doesNotMatch(html, /아직 등록된 다음 일정|등록 내역 없음|로그인 필요/);
});

test("failed schedule and fee queries render recovery instead of empty data", () => {
  const html = renderHome({ eventLoadError: true, feeLoadError: true });
  assert.equal(html.match(/일정을 불러오지 못했습니다\./g)?.length, 2);
  assert.match(html, /회비 정보를 불러오지 못했습니다/);
  assert.doesNotMatch(html, /아직 등록된 다음 일정|등록 내역 없음/);
});

test("successful empty queries and signed-out states stay distinct", () => {
  const empty = renderHome({});
  assert.match(empty, /아직 등록된 다음 일정/);
  assert.match(empty, /등록 내역 없음/);
  const anonymous = renderHome({ user: null, feeLoadError: true });
  assert.match(anonymous, /로그인 필요/);
  assert.doesNotMatch(anonymous, /회비 정보를 불러오지 못했습니다/);
});

test("the unlinked-account dialog explains recovery without linking to a locked form", () => {
  const html = renderToStaticMarkup(createElement(UnlinkedAccountModal, { onClose() {}, onSignOut() {} }));
  assert.match(html, /이 사이트에서 의견을 접수할 수 없습니다/);
  assert.match(html, /이름과 전화번호/);
  assert.match(html, /로그아웃/);
  assert.doesNotMatch(html, /href="\/feedback"/);
});
