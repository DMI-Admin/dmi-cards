"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type ToggleSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  focusRingOffsetClass?: string;
  onToggle: () => void;
};

export default function ToggleSwitch({
  checked,
  disabled = false,
  ariaLabel,
  focusRingOffsetClass = "focus:ring-offset-[var(--dmi-surface)]",
  onToggle,
}: ToggleSwitchProps) {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    onToggle();
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition focus:outline-none focus:ring-2 focus:ring-[#AC00FF]/55 focus:ring-offset-2 ${focusRingOffsetClass} ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${
        checked
          ? "border-[var(--brand-secondary,#AC00FF)] bg-[var(--brand-secondary,#AC00FF)] shadow-sm shadow-purple-500/15"
          : "border-[var(--dmi-border,rgba(255,255,255,0.16))] bg-[var(--dmi-surface-soft,rgba(255,255,255,0.1))] hover:border-[var(--border-brand,rgba(172,0,255,0.45))]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-[left] ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
