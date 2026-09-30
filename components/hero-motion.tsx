"use client";

import { useEffect, useRef } from "react";
import { BALL_DURATION, BALL_TIMING, ballPath, courtGeometry, pathProgress, syllableCueTimes } from "@/lib/hero-motion";

const SLOGAN = "우리의 주말, 우리의 풋살.";
const SECOND_LINE = ["우", "리", "의", " ", "풋", "살"];
const ease = { out: "cubic-bezier(0.16, 1, 0.3, 1)" };

/**
 * The visitor hero slogan, drawn as a play: the court is chalked in, a lob
 * lands under the second line, the ball rolls past each syllable as it rises
 * and hops into place as the full stop. Screen readers and crawlers get the
 * plain heading; the drawing is decorative. The server renders the finished
 * frame, reduced motion keeps it, and playback pauses while off screen or in
 * a background tab.
 */
export default function HeroMotion() {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const court = box.querySelector<SVGSVGElement>(".hero-motion-court");
    const fx = box.querySelector<SVGSVGElement>(".hero-motion-fx");
    const ball = box.querySelector<SVGCircleElement>(".hero-motion-ball");
    const kick = box.querySelector<SVGCircleElement>(".hero-motion-kick");
    const trail = box.querySelector<SVGPathElement>(".hero-motion-trail");
    const firstLine = box.querySelector<HTMLElement>(".hero-motion-l1");
    const slot = box.querySelector<HTMLElement>(".hero-motion-slot");
    const glyphs = [...box.querySelectorAll<HTMLElement>(".hero-motion-l2 .g")];
    if (!court || !fx || !ball || !kick || !trail || !firstLine || !slot) return;

    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animations: Animation[] = [];
    let inView = true;
    let pageVisible = !document.hidden;
    let lastWidth = 0;
    let resizeTimer = 0;

    const running = () => inView && pageVisible;
    const add = (element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = element.animate(keyframes, { fill: "both", ...options });
      if (!running()) animation.pause();
      animations.push(animation);
    };
    const sync = () => {
      const run = running();
      animations.forEach((animation) => {
        if (animation.playState === "finished" || animation.playState === "idle") return;
        if (run) animation.play(); else animation.pause();
      });
    };
    const clear = () => { animations.forEach((animation) => animation.cancel()); animations = []; };

    const build = () => {
      const W = box.clientWidth;
      const H = box.clientHeight;
      const fontSize = parseFloat(getComputedStyle(box).fontSize);
      const origin = box.getBoundingClientRect();
      court.setAttribute("viewBox", `0 0 ${W} ${H}`);
      fx.setAttribute("viewBox", `0 0 ${W} ${H}`);

      const { lines, spots, penaltyMark } = courtGeometry(W, H);
      court.innerHTML = lines.map((d) => `<path pathLength="1" d="${d}"/>`).join("") + spots.map((spot) => `<circle r="2" cx="${spot.x}" cy="${spot.y}"/>`).join("");
      court.querySelectorAll("path").forEach((path, index) => add(path, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 900, delay: index * 90, easing: ease.out }));
      court.querySelectorAll("circle").forEach((circle, index) => add(circle, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 500 + index * 60 }));

      add(firstLine, [{ opacity: 0, transform: "translateY(.3em)" }, { opacity: 1, transform: "none" }], { duration: 700, delay: 250, easing: ease.out });

      const slotRect = slot.getBoundingClientRect();
      const { samples, stop, radius, endScale } = ballPath({
        width: W,
        height: H,
        fontSize,
        firstLeft: glyphs[0].getBoundingClientRect().left - origin.left,
        slotLeft: slotRect.left - origin.left,
        baseline: slotRect.bottom - origin.top,
        start: penaltyMark,
      });
      const kickAt = BALL_TIMING.kick;

      ball.setAttribute("r", radius.toFixed(2));
      const ballFrames: Keyframe[] = samples.map((sample) => ({ offset: sample.t / BALL_DURATION, transform: `translate(${sample.x.toFixed(1)}px,${sample.y.toFixed(1)}px) scale(${sample.s.toFixed(3)})` }));
      ballFrames.push({ offset: 1, transform: `translate(${stop.x.toFixed(1)}px,${stop.y.toFixed(1)}px) scale(${endScale.toFixed(3)})` });
      add(ball, ballFrames, { duration: BALL_DURATION, delay: kickAt, easing: "linear" });
      add(ball, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: kickAt });

      kick.setAttribute("r", (radius * 1.4).toFixed(2));
      kick.setAttribute("cx", String(penaltyMark.x));
      kick.setAttribute("cy", String(penaltyMark.y));
      kick.style.transformOrigin = `${penaltyMark.x}px ${penaltyMark.y}px`;
      add(kick, [{ opacity: 0.7, transform: "scale(.6)" }, { opacity: 0, transform: "scale(1.9)" }], { duration: 520, delay: kickAt, easing: ease.out, fill: "forwards" });

      const { length, cumulative } = pathProgress(samples);
      trail.setAttribute("d", `M${samples.map((sample) => `${sample.x.toFixed(1)} ${sample.y.toFixed(1)}`).join("L")}`);
      const trailFrames: Keyframe[] = samples.map((sample, index) => ({ offset: sample.t / BALL_DURATION, strokeDashoffset: 1 - cumulative[index] / length }));
      trailFrames.push({ offset: 1, strokeDashoffset: 0 });
      add(trail, trailFrames, { duration: BALL_DURATION, delay: kickAt, easing: "linear" });
      add(trail, [{ opacity: 0.5 }, { opacity: 0.26 }], { duration: 700, delay: kickAt + BALL_DURATION, easing: ease.out });

      const centers = glyphs.map((glyph) => { const rect = glyph.getBoundingClientRect(); return rect.left + rect.width / 2 - origin.left; });
      syllableCueTimes(samples, centers).forEach((cue, index) => {
        add(glyphs[index], [{ opacity: 0, transform: "translateY(.3em)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: kickAt + cue - 60, easing: ease.out });
      });
    };

    /** Draw the sequence; without motion (or on a resize) it jumps straight to the last frame. */
    const render = (animate: boolean) => {
      clear();
      // Drop the no-script full stop before measuring; the ball takes its place.
      box.dataset.ready = "true";
      build();
      if (!animate || reduceQuery.matches) animations.forEach((animation) => { try { animation.finish(); } catch { animation.cancel(); } });
      sync();
      lastWidth = box.clientWidth;
    };

    const intersection = new IntersectionObserver((entries) => { inView = entries[entries.length - 1].isIntersecting; sync(); });
    intersection.observe(box);
    const onVisibility = () => { pageVisible = !document.hidden; sync(); };
    document.addEventListener("visibilitychange", onVisibility);
    const onReduce = () => render(false);
    reduceQuery.addEventListener("change", onReduce);
    const resize = new ResizeObserver(() => {
      if (!lastWidth || Math.abs(box.clientWidth - lastWidth) < 1) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => render(false), 120);
    });
    resize.observe(box);

    // Webfonts change glyph widths, so measure once they are ready.
    let cancelled = false;
    void document.fonts.ready.then(() => { if (!cancelled) render(true); });

    return () => {
      cancelled = true;
      window.clearTimeout(resizeTimer);
      intersection.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reduceQuery.removeEventListener("change", onReduce);
      clear();
    };
  }, []);

  return <>
    <h1 className="sr-only">{SLOGAN}</h1>
    <div className="hero-motion" aria-hidden="true">
      <div ref={boxRef} className="hero-motion-box">
        <svg className="hero-motion-court" preserveAspectRatio="none" />
        <div className="hero-motion-type">
          <span className="hero-motion-l1">우리의 주말,</span>
          <span className="hero-motion-l2">{SECOND_LINE.map((glyph, index) => glyph === " " ? " " : <span key={index} className="g">{glyph}</span>)}<i className="hero-motion-slot" /></span>
        </div>
        <svg className="hero-motion-fx"><path className="hero-motion-trail" pathLength="1" /><circle className="hero-motion-kick" /><circle className="hero-motion-ball" /></svg>
      </div>
    </div>
  </>;
}
