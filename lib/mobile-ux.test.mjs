import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("keeps ranking tables inside the page grid on narrow screens", () => {
  assert.match(
    styles,
    /\.ranking-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
  );
});

test("keeps form controls at the iOS no-zoom font size", () => {
  assert.match(styles, /\.password-auth-form input,[\s\S]*?\.editor textarea\s*\{\s*font-size:\s*16px;/);
});

test("fits all seven calendar columns on mobile and uses compact event markers", () => {
  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 760px)"));
  assert.match(mobileStyles, /\.month-calendar-grid\s*\{\s*min-width:\s*0;/);
  assert.match(mobileStyles, /\.day-event\s*\{[^}]*width:\s*8px;[^}]*height:\s*8px;/s);
  assert.match(mobileStyles, /\.day-event b,[\s\S]*?\.day-event span\s*\{\s*display:\s*none;/);
});

test("keeps event-card links at the minimum mobile touch target height", () => {
  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 760px)"));
  assert.match(mobileStyles, /\.event-card-link\s*\{[^}]*min-height:\s*var\(--tap\);/s);
  assert.match(mobileStyles, /\.event-card-schedule a,[\s\S]*?\.event-card-chip\.unassigned\s*\{\s*min-height:\s*var\(--tap\);/);
});

test("keeps visible event labels at or above twelve pixels", () => {
  assert.match(styles, /\.month-calendar > header small\s*\{[^}]*font-size:\s*12px;/s);
  assert.match(styles, /\.event-date small\s*\{[^}]*font-size:\s*12px;/s);
  assert.match(styles, /\.event-card-chip\s*\{[^}]*font-size:\s*12px;/s);
  assert.match(styles, /\.event-card-section-heading span\s*\{[^}]*font-size:\s*12px;/s);
  assert.match(styles, /\.event-detail-chips span\s*\{[^}]*font-size:\s*12px;/s);
});
