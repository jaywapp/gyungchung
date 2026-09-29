"use client";

import { useEffect, useId, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY, parseThemePreference, resolveTheme, type ThemePreference } from "@/lib/theme";

const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "라이트", icon: Sun },
  { value: "dark", label: "다크", icon: Moon },
  { value: "system", label: "시스템", icon: Monitor },
];

function readPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function applyTheme(preference: ThemePreference) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark);
}

/** Light · dark · system, stored per browser. "system" keeps following the OS while the page is open. */
export default function ThemeSwitch() {
  const name = useId();
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => { setPreference(readPreference()); }, []);

  useEffect(() => {
    if (preference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [preference]);

  const choose = (next: ThemePreference) => {
    setPreference(next);
    applyTheme(next);
    // Private browsing can refuse storage; the choice still holds for this visit.
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch {}
  };

  return <fieldset className="theme-switch">
    <legend>화면 테마</legend>
    <div>{options.map(({ value, label, icon: Icon }) => <label key={value} className={preference === value ? "selected" : undefined}>
      <input type="radio" name={name} value={value} checked={preference === value} onChange={() => choose(value)} />
      <Icon size={16} aria-hidden="true" /> {label}
    </label>)}</div>
  </fieldset>;
}
