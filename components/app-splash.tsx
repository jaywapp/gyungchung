"use client";

import { useEffect, useRef } from "react";
import { BALL_TRAVEL, SPLASH_EXIT_AT, SPLASH_FAILSAFE, SPLASH_SESSION_KEY, SPLASH_STORAGE_KEY, SPLASH_TIMING, WORDMARK, ballPath, letterCueTimes, pathProgress, wordmarkLayout, wordmarkSize } from "@/lib/splash-motion";

const ease = { out: "cubic-bezier(0.16, 1, 0.3, 1)" };

/**
 * Launch splash for the installed web app. The inline head script decides
 * the mode on html[data-splash] before first paint, so this overlay is
 * visible from the first frame; this component only plays it and removes it.
 * First launch: the ball lifts G·C·F·C and settles as the full stop. Later
 * launches and reduced motion: the finished frame, briefly. A tap skips.
 */
export default function AppSplash() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    const root = rootRef.current;
    const mode = html.dataset.splash;
    if (!root || (mode !== "full" && mode !== "short")) return;

    const court = root.querySelector<SVGSVGElement>(".app-splash-court");
    const fx = root.querySelector<SVGSVGElement>(".app-splash-fx");
    const knock = root.querySelector<SVGRectElement>(".app-splash-knock");
    const letters = [...root.querySelectorAll<SVGTextElement>(".app-splash-letter")];
    const tagline = root.querySelector<SVGTextElement>(".app-splash-tagline");
    const trail = root.querySelector<SVGPathElement>(".app-splash-trail");
    const ring = root.querySelector<SVGCircleElement>(".app-splash-ring");
    const ball = root.querySelector<SVGCircleElement>(".app-splash-ball");
    if (!court || !fx || !knock || !tagline || !trail || !ring || !ball || letters.length !== WORDMARK.length) return;
    // From here this component owns the exit, so the head script's hard stop can go.
    const failsafe = (window as unknown as Record<string, number | undefined>)[SPLASH_FAILSAFE];
    if (failsafe !== undefined) window.clearTimeout(failsafe);

    let animations: Animation[] = [];
    let done = false;
    let timer = 0;
    let cancelled = false;

    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
        localStorage.setItem(SPLASH_STORAGE_KEY, "1");
      } catch {
        // Storage can be blocked; the splash simply shows again next time.
      }
      animations.forEach((animation) => animation.cancel());
      animations = [];
      delete html.dataset.splash;
    };
    const add = (element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      animations.push(element.animate(keyframes, { fill: "both", ...options }));
    };
    const exit = (delay: number) => {
      const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SPLASH_TIMING.exit, delay, easing: "ease-out", fill: "forwards" });
      animations.push(fade);
      fade.onfinish = finish;
    };

    const build = () => {
      const W = root.clientWidth;
      const H = root.clientHeight;
      const size = wordmarkSize(W);
      const baseline = Math.round(H * 0.47 + size * 0.35);
      const cx = W / 2;
      const midline = baseline - size * 0.36;
      const penalty = { x: cx, y: Math.round(H * 0.84) };
      court.setAttribute("viewBox", `0 0 ${W} ${H}`);
      fx.setAttribute("viewBox", `0 0 ${W} ${H}`);
      court.innerHTML = `<line x1="0" y1="${midline}" x2="${W}" y2="${midline}"/><circle cx="${cx}" cy="${midline}" r="${size * 1.05}"/><circle class="spot" cx="${cx}" cy="${midline}" r="3"/><circle class="spot" cx="${penalty.x}" cy="${penalty.y}" r="3"/>`;

      letters.forEach((letter) => { letter.setAttribute("font-size", String(size)); letter.setAttribute("y", String(baseline)); });
      const layout = wordmarkLayout(letters.map((letter) => letter.getComputedTextLength()), size, cx);
      letters.forEach((letter, index) => letter.setAttribute("x", layout.letters[index].x.toFixed(1)));
      knock.setAttribute("x", (layout.left - size * 0.2).toFixed(1));
      knock.setAttribute("y", (baseline - size * 0.82).toFixed(1));
      knock.setAttribute("width", (layout.right - layout.left + size * 0.4).toFixed(1));
      knock.setAttribute("height", (size * 0.98).toFixed(1));
      tagline.setAttribute("x", String(cx));
      tagline.setAttribute("y", String(baseline + Math.round(size * 0.6)));
      tagline.setAttribute("font-size", String(Math.max(10, Math.round(size * 0.15))));

      const { samples, stop } = ballPath({ start: penalty, left: layout.left, stopX: layout.stopX, baseline, size, radius: layout.radius });
      ball.setAttribute("r", layout.radius.toFixed(2));
      const kick = SPLASH_TIMING.kick;
      add(ball, samples.map((sample) => ({ offset: sample.t / BALL_TRAVEL, transform: `translate(${sample.x.toFixed(1)}px,${sample.y.toFixed(1)}px) scale(${sample.s.toFixed(3)})` })), { duration: BALL_TRAVEL, delay: kick, easing: "linear" });
      add(ball, [{ opacity: 0 }, { opacity: 1 }], { duration: 80, delay: kick });

      const { cumulative, length } = pathProgress(samples);
      trail.setAttribute("d", `M${samples.map((sample) => `${sample.x.toFixed(1)} ${sample.y.toFixed(1)}`).join("L")}`);
      add(trail, samples.map((sample, index) => ({ offset: sample.t / BALL_TRAVEL, strokeDashoffset: 1 - cumulative[index] / length })), { duration: BALL_TRAVEL, delay: kick, easing: "linear" });

      ring.setAttribute("cx", String(penalty.x));
      ring.setAttribute("cy", String(penalty.y));
      ring.setAttribute("r", (layout.radius * 1.4).toFixed(2));
      ring.style.transformOrigin = `${penalty.x}px ${penalty.y}px`;
      add(ring, [{ opacity: 0.8, transform: "scale(.6)" }, { opacity: 0, transform: "scale(2.4)" }], { duration: 500, delay: kick, easing: ease.out });

      const cues = letterCueTimes(samples, layout.letters.map((letter) => letter.center));
      add(knock, [{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: kick + cues[0] - 40, easing: "ease-out" });
      letters.forEach((letter, index) => add(letter, [{ opacity: 0, transform: `translateY(${size * 0.2}px)` }, { opacity: 1, transform: "none" }], { duration: 360, delay: kick + cues[index] - 40, easing: ease.out }));
      add(tagline, [{ opacity: 0, letterSpacing: "0.1em" }, { opacity: 1, letterSpacing: "0.22em" }], { duration: 420, delay: kick + BALL_TRAVEL - 60, easing: ease.out });
      void stop;
    };

    const start = () => {
      if (cancelled) return;
      build();
      if (mode === "short") {
        animations.forEach((animation) => animation.finish());
        exit(SPLASH_TIMING.short);
      } else {
        exit(SPLASH_EXIT_AT);
      }
    };

    root.addEventListener("pointerdown", finish);
    // Letter widths depend on the wordmark face, so wait for it (bounded).
    const family = getComputedStyle(letters[0]).fontFamily;
    const fontReady = document.fonts.load(`italic 900 ${wordmarkSize(root.clientWidth)}px ${family}`).catch(() => undefined);
    const budget = new Promise((resolve) => { timer = window.setTimeout(resolve, 700); });
    void Promise.race([fontReady, budget]).then(start);

    return () => {
      cancelled = true;
      root.removeEventListener("pointerdown", finish);
      window.clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
    };
  }, []);

  return (
    <div ref={rootRef} className="app-splash" aria-hidden="true">
      <svg className="app-splash-court" preserveAspectRatio="none" />
      <svg className="app-splash-fx">
        <path className="app-splash-trail" pathLength={1} />
        <rect className="app-splash-knock" />
        {WORDMARK.map(({ glyph, accent }, index) => <text key={index} className={accent ? "app-splash-letter accent" : "app-splash-letter"}>{glyph}</text>)}
        <text className="app-splash-tagline" textAnchor="middle">WEEKEND FUTSAL CLUB · EST. 2018</text>
        <circle className="app-splash-ring" />
        <circle className="app-splash-ball" />
      </svg>
    </div>
  );
}
