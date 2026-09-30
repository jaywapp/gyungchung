import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./hero-motion.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { courtGeometry, ballPath, syllableCueTimes, pathProgress, BALL_TIMING } = compiledModule.exports;

test("the court fills the box inside its margin and marks five spots", () => {
  const { lines, spots, penaltyMark } = courtGeometry(400, 200);
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^M1\.5 1\.5H398\.5V198\.5H1\.5Z$/);
  assert.equal(spots.length, 5);
  assert.ok(Math.abs(penaltyMark.x - (1.5 + 34 * (397 / 40))) <= 0.1);
  assert.equal(penaltyMark.y, 100);
});

const input = { width: 600, height: 300, fontSize: 80, firstLeft: 0, slotLeft: 480, baseline: 200, start: { x: 510, y: 150 } };

test("the ball starts at the kick spot, rolls under the line and stops on the full stop", () => {
  const { samples, stop } = ballPath(input);
  assert.deepEqual({ x: samples[0].x, y: samples[0].y }, input.start);
  const rolling = samples.filter((sample) => sample.t > BALL_TIMING.lob && sample.t <= BALL_TIMING.lob + BALL_TIMING.roll);
  assert.ok(rolling.every((sample) => sample.y === input.baseline + 0.2 * input.fontSize));
  const last = samples[samples.length - 1];
  assert.ok(Math.abs(last.x - stop.x) < 1e-9 && Math.abs(last.y - stop.y) < 1e-9);
  assert.equal(stop.x, input.slotLeft + 0.12 * input.fontSize);
  assert.ok(samples.every((sample, index) => index === 0 || sample.t >= samples[index - 1].t));
});

test("syllables light up left to right, never before the ball lands", () => {
  const { samples } = ballPath(input);
  const cues = syllableCueTimes(samples, [40, 120, 200, 300, 380]);
  assert.ok(cues.every((cue) => cue >= BALL_TIMING.lob));
  assert.ok(cues.every((cue, index) => index === 0 || cue >= cues[index - 1]));
});

test("trail progress grows monotonically to the full length", () => {
  const { length, cumulative } = pathProgress([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }]);
  assert.equal(length, 11);
  assert.deepEqual(cumulative, [0, 5, 11]);
});
