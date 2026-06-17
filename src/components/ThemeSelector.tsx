"use client";

import { useEffect, useState } from "react";

type ThemeChoice = "system" | "light" | "dark";

const themeOptions: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const storageKey = "dmi-theme";

function applyTheme(theme: ThemeChoice) {
  document.documentElement.dataset.theme = theme;
}

function storedTheme(): ThemeChoice {
  if (typeof window === "undefined") return "system";

  const value = window.localStorage.getItem(storageKey);

  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export default function ThemeSelector() {
  const [theme, setTheme] = useState<ThemeChoice>(() => storedTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function selectTheme(nextTheme: ThemeChoice) {
    setTheme(nextTheme);
    window.localStorage.setItem(storageKey, nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Theme</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Choose how DMI Cards appears on this device.
          </p>
        </div>

        <div className="inline-flex rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-1">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => selectTheme(option.value)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                theme === option.value
                  ? "bg-[image:var(--brand-gradient)] text-white shadow-[var(--brand-glow)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
