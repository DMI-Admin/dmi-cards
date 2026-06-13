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
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Theme</p>
          <p className="mt-1 text-sm text-white/50">
            Choose how DMI Cards appears on this device.
          </p>
        </div>

        <div className="inline-flex rounded-2xl border border-white/10 bg-white/5 p-1">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => selectTheme(option.value)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                theme === option.value
                  ? "bg-[#AC00FF] text-white shadow-lg shadow-purple-500/20"
                  : "text-white/65 hover:bg-white/10 hover:text-white"
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
