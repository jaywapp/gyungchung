import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./member-directory.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { positionOf, positionChipLabel, nameInitials, sortDirectory, countByPosition } = compiledModule.exports;

const member = (name, extra = {}) => ({ name, position: null, role: "member", officer_title: null, is_system_admin: false, ...extra });

test("unset and 'any' positions share one bucket but keep distinct chip words", () => {
  assert.equal(positionOf({ position: null }), "ANY");
  assert.equal(positionOf({ position: "ANY" }), "ANY");
  assert.equal(positionOf({ position: "MF" }), "MF");
  assert.equal(positionChipLabel({ position: null }), "미정");
  assert.equal(positionChipLabel({ position: "ANY" }), "무관");
  assert.equal(positionChipLabel({ position: "GK" }), "GK");
});

test("initials keep the last two characters of the name", () => {
  assert.equal(nameInitials("한지호"), "지호");
  assert.equal(nameInitials("남궁민수"), "민수");
  assert.equal(nameInitials("준"), "준");
});

test("officers lead in title order, then managers, system admins, and the rest by name", () => {
  const sorted = sortDirectory([
    member("하준"),
    member("가온"),
    member("다온", { is_system_admin: true }),
    member("나래", { role: "manager" }),
    member("총무님", { role: "manager", officer_title: "treasurer" }),
    member("회장님", { role: "manager", officer_title: "president" }),
    member("부회장님", { role: "manager", officer_title: "vice_president" }),
  ]);
  assert.deepEqual(sorted.map((profile) => profile.name), ["회장님", "부회장님", "총무님", "나래", "다온", "가온", "하준"]);
});

test("position counts add up to the whole squad", () => {
  const counts = countByPosition([{ position: "FW" }, { position: "FW" }, { position: "GK" }, { position: null }, { position: "ANY" }]);
  assert.deepEqual(counts, { ALL: 5, FW: 2, MF: 0, DF: 0, GK: 1, ANY: 2 });
});
