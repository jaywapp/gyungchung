import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./splash-motion.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { wordmarkSize, wordmarkLayout, ballPath, letterCueTimes, pathProgress, splashMode, splashInitScript, SPLASH_TIMING, SPLASH_EXIT_AT, BALL_TRAVEL } = compiledModule.exports;

test("the wordmark scales with the phone width and caps on wide screens", () => {
  assert.equal(wordmarkSize(390), 74);
  assert.equal(wordmarkSize(1440), 88);
});

test("GCFC is centred with a word gap and room for the ball", () => {
  const layout = wordmarkLayout([50, 48, 40, 48], 80, 200);
  assert.ok(Math.abs((layout.left + layout.right) / 2 - 200) < 1e-9);
  assert.equal(layout.letters[1].x, layout.letters[0].x + 50);
  assert.equal(layout.letters[2].x, layout.letters[1].x + 48 + 80 * 0.16);
  assert.ok(layout.stopX > layout.letters[3].x + 48);
  assert.ok(layout.stopX + layout.radius <= layout.right + 1e-9);
});

test("the ball is kicked from the mark, rolls under the letters and rests on the baseline", () => {
  const start = { x: 200, y: 700 };
  const { samples, stop } = ballPath({ start, left: 60, stopX: 330, baseline: 420, size: 80, radius: 8.8 });
  assert.deepEqual({ x: samples[0].x, y: samples[0].y }, start);
  const rolling = samples.filter((sample) => sample.t > SPLASH_TIMING.lob && sample.t <= SPLASH_TIMING.lob + SPLASH_TIMING.roll);
  assert.ok(rolling.every((sample) => sample.y === 420 + 80 * 0.2));
  const last = samples[samples.length - 1];
  assert.ok(Math.abs(last.x - stop.x) < 1e-9 && Math.abs(last.y - stop.y) < 1e-9);
  assert.equal(stop.y, 420 - 8.8 + 1);
  assert.equal(last.t, BALL_TRAVEL);
  assert.ok(samples.every((sample, index) => index === 0 || sample.t >= samples[index - 1].t));
});

test("letters rise left to right, never before the ball lands", () => {
  const { samples } = ballPath({ start: { x: 200, y: 700 }, left: 60, stopX: 330, baseline: 420, size: 80, radius: 8.8 });
  const cues = letterCueTimes(samples, [85, 135, 200, 250]);
  assert.ok(cues.every((cue) => cue >= SPLASH_TIMING.lob));
  assert.ok(cues.every((cue, index) => index === 0 || cue >= cues[index - 1]));
  const { cumulative, length } = pathProgress(samples);
  assert.equal(cumulative[cumulative.length - 1], length);
});

test("the full motion stays under two seconds including the fade", () => {
  assert.ok(SPLASH_EXIT_AT + SPLASH_TIMING.exit <= 2000);
});

test("the splash shows only on installed launches, fully only the first time", () => {
  const base = { standalone: true, preview: false, playedThisSession: false, seenBefore: false, reducedMotion: false };
  assert.equal(splashMode(base), "full");
  assert.equal(splashMode({ ...base, seenBefore: true }), "short");
  assert.equal(splashMode({ ...base, reducedMotion: true }), "short");
  assert.equal(splashMode({ ...base, playedThisSession: true }), null);
  assert.equal(splashMode({ ...base, standalone: false }), null);
  assert.equal(splashMode({ ...base, standalone: false, preview: true, seenBefore: true }), "full");
});

function runInitScript({ search = "", standalone = false, reduced = false, session = {}, local = {} }) {
  const dataset = {};
  const matchMedia = (query) => ({ matches: query.includes("standalone") ? standalone : query.includes("reduce") ? reduced : false });
  const store = (values) => ({ getItem: (key) => values[key] ?? null });
  const timers = [];
  const win = { matchMedia };
  new Function("document", "window", "location", "navigator", "sessionStorage", "localStorage", "setTimeout", splashInitScript)(
    { documentElement: { dataset } }, win, { search }, {}, store(session), store(local), (fn, ms) => timers.push(ms),
  );
  return { mode: dataset.splash, timers, failsafe: win.__gcSplashFailsafe };
}

test("the head script agrees with splashMode and arms the failsafe", () => {
  assert.deepEqual(runInitScript({ standalone: true }), { mode: "full", timers: [SPLASH_TIMING.failsafe], failsafe: 1 });
  assert.equal(runInitScript({ standalone: true, local: { "gc-splash-seen": "1" } }).mode, "short");
  assert.equal(runInitScript({ standalone: true, session: { "gc-splash-session": "1" } }).mode, undefined);
  assert.equal(runInitScript({}).mode, undefined);
  assert.equal(runInitScript({ search: "?splash=preview", local: { "gc-splash-seen": "1" } }).mode, "full");
});
