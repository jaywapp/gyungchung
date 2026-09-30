/**
 * Geometry and timing for the launch splash: a ball is kicked from the
 * penalty mark, rolls under the GCFC wordmark lifting each letter, and hops
 * into place as the full stop. Pure functions only, so the Expo app can draw
 * the same motion with its own renderer.
 */

export type SplashMode = "full" | "short";

export const SPLASH_STORAGE_KEY = "gc-splash-seen";
export const SPLASH_SESSION_KEY = "gc-splash-session";
export const SPLASH_BACKGROUND = "#0b1f33";
/** Window property holding the head script's failsafe timer; the component clears it once it takes over. */
export const SPLASH_FAILSAFE = "__gcSplashFailsafe";

export const SPLASH_TIMING = {
  kick: 150,
  lob: 480,
  roll: 420,
  hop: 220,
  hold: 260,
  exit: 280,
  /** How long the finished frame stays up on later launches. */
  short: 400,
  /** Hard stop in the inline script in case the component never takes over. */
  failsafe: 4000,
} as const;

export const BALL_TRAVEL = SPLASH_TIMING.lob + SPLASH_TIMING.roll + SPLASH_TIMING.hop;
export const SPLASH_EXIT_AT = SPLASH_TIMING.kick + BALL_TRAVEL + SPLASH_TIMING.hold;

export const WORDMARK = [
  { glyph: "G", accent: false },
  { glyph: "C", accent: false },
  { glyph: "F", accent: true },
  { glyph: "C", accent: false },
] as const;

export type Point = { x: number; y: number };
export type BallSample = Point & { t: number; s: number };

/** Font size for a viewport: large on phones, capped on wide screens. */
export function wordmarkSize(width: number): number {
  return Math.round(Math.min(width * 0.19, 88));
}

/**
 * Places the four letters centred on `centerX`, with a word gap between GC
 * and FC and room for the ball after the last C.
 */
export function wordmarkLayout(widths: number[], size: number, centerX: number) {
  const gap = size * 0.16;
  const radius = size * 0.11;
  const total = widths.reduce((sum, width) => sum + width, 0) + gap + radius * 2 + size * 0.12;
  const left = centerX - total / 2;
  let cursor = left;
  const letters = widths.map((width, index) => {
    if (index === 2) cursor += gap;
    const letter = { x: cursor, center: cursor + width / 2 };
    cursor += width;
    return letter;
  });
  return { left, right: left + total, letters, radius, stopX: cursor + size * 0.12 + radius };
}

const quad = (a: number, b: number, c: number, t: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;

/** Samples the lob, the roll under the baseline and the hop onto the full stop. */
export function ballPath({ start, left, stopX, baseline, size, radius }: { start: Point; left: number; stopX: number; baseline: number; size: number; radius: number }) {
  const { lob, roll, hop } = SPLASH_TIMING;
  const floor = baseline + size * 0.2;
  const rollEnd = stopX - size * 0.15;
  const stop = { x: stopX, y: baseline - radius + 1 };
  const peak = Math.min(start.y, baseline) - size * 2.6;
  const samples: BallSample[] = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    samples.push({ t: u * lob, x: quad(start.x, (start.x + left) / 2 - size * 0.4, left, u), y: quad(start.y, peak, floor, u), s: 1 + 0.6 * Math.sin(Math.PI * u) });
  }
  for (let i = 1; i <= 18; i++) {
    const u = i / 18;
    samples.push({ t: lob + u * roll, x: left + (rollEnd - left) * (1 - (1 - u) * (1 - u)), y: floor, s: 1 });
  }
  for (let i = 1; i <= 10; i++) {
    const u = i / 10;
    samples.push({ t: lob + roll + u * hop, x: quad(rollEnd, stop.x - size * 0.06, stop.x, u), y: quad(floor, stop.y - size * 0.65, stop.y, u), s: 1 });
  }
  return { samples, stop };
}

/** When the rolling ball reaches each letter; never before it lands. */
export function letterCueTimes(samples: BallSample[], centers: number[]): number[] {
  const rolling = samples.filter((sample) => sample.t >= SPLASH_TIMING.lob);
  return centers.map((center) => (rolling.find((sample) => sample.x >= center - 12) ?? rolling[rolling.length - 1]).t);
}

/** Cumulative path length at each sample, for drawing the trail in step with the ball. */
export function pathProgress(samples: Point[]) {
  const cumulative = [0];
  for (let i = 1; i < samples.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
  return { cumulative, length: cumulative[cumulative.length - 1] };
}

/**
 * Decides whether this page load shows the splash. Installed launches only
 * (or an explicit preview); once per session; the full motion only on the
 * first launch and never under reduced motion.
 */
export function splashMode({ standalone, preview, playedThisSession, seenBefore, reducedMotion }: { standalone: boolean; preview: boolean; playedThisSession: boolean; seenBefore: boolean; reducedMotion: boolean }): SplashMode | null {
  if (preview) return reducedMotion ? "short" : "full";
  if (!standalone || playedThisSession) return null;
  return seenBefore || reducedMotion ? "short" : "full";
}

/**
 * Runs in <head> before first paint so the overlay covers the app from the
 * first frame. Inlined as a string, so it mirrors `splashMode` by hand.
 */
export const splashInitScript = `(function(){try{var d=document.documentElement,q=location.search.indexOf("splash=preview")>-1,s=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;if(!q&&!s)return;var r=window.matchMedia("(prefers-reduced-motion: reduce)").matches,p=false,n=false;try{p=sessionStorage.getItem("${SPLASH_SESSION_KEY}")==="1";n=localStorage.getItem("${SPLASH_STORAGE_KEY}")==="1";}catch(e){n=true;}var m=q?(r?"short":"full"):(p?null:(n||r?"short":"full"));if(!m)return;d.dataset.splash=m;window.${SPLASH_FAILSAFE}=setTimeout(function(){delete d.dataset.splash;},${SPLASH_TIMING.failsafe});}catch(e){}})();`;
