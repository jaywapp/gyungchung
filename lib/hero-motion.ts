/**
 * Geometry for the visitor hero: a futsal court fitted to the slogan box and
 * the ball's path (lob from the right penalty mark, roll under the second
 * line, hop into the full stop). Pure numbers so it can be tested without a DOM.
 */

export type Point = { x: number; y: number };
export type BallSample = Point & { t: number; s: number };

/** Milliseconds for each phase of the ball's run, measured from the kick. */
export const BALL_TIMING = { kick: 1000, lob: 1000, roll: 950, hop: 300, settle: 260 };
export const BALL_DURATION = BALL_TIMING.lob + BALL_TIMING.roll + BALL_TIMING.hop + BALL_TIMING.settle;

/** A 40 × 20 m pitch scaled into a W × H box with a small margin. */
export function courtGeometry(W: number, H: number, margin = 1.5) {
  const sx = (W - 2 * margin) / 40;
  const sy = (H - 2 * margin) / 20;
  const X = (v: number) => +(margin + v * sx).toFixed(1);
  const Y = (v: number) => +(margin + v * sy).toFixed(1);
  const arc = (r: number) => `${(r * sx).toFixed(1)} ${(r * sy).toFixed(1)}`;
  const lines = [
    `M${X(0)} ${Y(0)}H${X(40)}V${Y(20)}H${X(0)}Z`,
    `M${X(20)} ${Y(0)}V${Y(20)}`,
    `M${X(17)} ${Y(10)}A${arc(3)} 0 1 1 ${X(23)} ${Y(10)}A${arc(3)} 0 1 1 ${X(17)} ${Y(10)}`,
    `M${X(0)} ${Y(2.42)}A${arc(6)} 0 0 1 ${X(6)} ${Y(8.42)}L${X(6)} ${Y(11.58)}A${arc(6)} 0 0 1 ${X(0)} ${Y(17.58)}`,
    `M${X(40)} ${Y(2.42)}A${arc(6)} 0 0 0 ${X(34)} ${Y(8.42)}L${X(34)} ${Y(11.58)}A${arc(6)} 0 0 0 ${X(40)} ${Y(17.58)}`,
  ];
  const spots: Point[] = [[6, 10], [34, 10], [20, 10], [10, 10], [30, 10]].map(([a, b]) => ({ x: X(a), y: Y(b) }));
  return { lines, spots, penaltyMark: { x: X(34), y: Y(10) } };
}

const quad = (a: Point, c: Point, b: Point, u: number): Point => ({
  x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * c.x + u * u * b.x,
  y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * c.y + u * u * b.y,
});

type PathInput = {
  width: number;
  height: number;
  fontSize: number;
  /** Left edge of the first syllable of the second line, relative to the box. */
  firstLeft: number;
  /** Left edge of the full-stop slot, relative to the box. */
  slotLeft: number;
  /** Baseline of the second line, relative to the box. */
  baseline: number;
  start: Point;
};

/** Sampled ball positions over time; `s` is the ball's scale (it swells mid-lob). */
export function ballPath({ width, height, fontSize, firstLeft, slotLeft, baseline, start }: PathInput) {
  const { lob, roll, hop } = BALL_TIMING;
  const r0 = 0.13 * fontSize;
  const rEnd = 0.1 * fontSize;
  const periodX = slotLeft + 0.12 * fontSize;
  const underY = baseline + 0.2 * fontSize;
  const control = { x: width * 0.5, y: -height * 0.4 };
  const landing = { x: Math.max(firstLeft, r0 + 2), y: underY };
  const rollEnd = { x: periodX - 0.34 * fontSize, y: underY };
  const stop = { x: periodX, y: baseline - rEnd };
  const hopControl = { x: (rollEnd.x + stop.x) / 2, y: baseline - 0.5 * fontSize };
  const samples: BallSample[] = [];
  for (let i = 0; i <= 36; i += 1) {
    const t = i / 36;
    samples.push({ ...quad(start, control, landing, t), t: t * lob, s: 1 + 0.55 * Math.sin(Math.PI * t) });
  }
  for (let i = 1; i <= 30; i += 1) {
    const t = i / 30;
    const u = 1 - Math.pow(1 - t, 3);
    samples.push({ x: landing.x + (rollEnd.x - landing.x) * u, y: underY, t: lob + t * roll, s: 1 });
  }
  for (let i = 1; i <= 12; i += 1) {
    const t = i / 12;
    samples.push({ ...quad(rollEnd, hopControl, stop, t), t: lob + roll + t * hop, s: 1 });
  }
  return { samples, stop, radius: r0, endScale: rEnd / r0 };
}

/** When (ms after the kick) the rolling ball passes under each syllable's centre. */
export function syllableCueTimes(samples: BallSample[], centers: number[]) {
  const { lob } = BALL_TIMING;
  return centers.map((center) => {
    const hit = samples.find((sample) => sample.t >= lob && sample.x >= center) ?? samples[samples.length - 1];
    return Math.max(hit.t, lob);
  });
}

/** Cumulative length along the sampled path, for drawing the trail in step with the ball. */
export function pathProgress(samples: Point[]) {
  let length = 0;
  const cumulative = [0];
  for (let i = 1; i < samples.length; i += 1) {
    length += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
    cumulative.push(length);
  }
  return { length, cumulative };
}
