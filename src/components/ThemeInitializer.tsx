"use client";

import { useEffect } from "react";

type ThemeChoice = "light" | "dark" | "system";

function storedTheme(): ThemeChoice {
  try {
    const value = window.localStorage.getItem("dmi-theme");
    return value === "light" || value === "dark" || value === "system"
      ? value
      : "system";
  } catch {
    return "system";
  }
}

export default function ThemeInitializer() {
  useEffect(() => {
    document.documentElement.dataset.theme = storedTheme();
  }, []);

  return null;
}
