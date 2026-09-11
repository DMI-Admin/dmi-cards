"use client";

import { useState } from "react";

const fallbackHex = "#000000";

function normalizeHexInput(value: string) {
  const trimmed = value.trim();
  const prefixed = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;

  if (/^#[0-9a-fA-F]{6}$/.test(prefixed)) {
    return prefixed.toUpperCase();
  }

  return null;
}

export function normalizeHexColour(value: string | null | undefined) {
  if (!value) return null;

  return normalizeHexInput(value);
}

export default function ColourPicker({
  label,
  value,
  onChange,
  helperText,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helperText?: string;
  className?: string;
}) {
  const normalizedValue = normalizeHexColour(value) || fallbackHex;
  const [draftState, setDraftState] = useState({
    source: normalizedValue,
    draft: normalizedValue,
  });
  const inputValue =
    draftState.source === normalizedValue ? draftState.draft : normalizedValue;
  const validInput = normalizeHexInput(inputValue);

  function commitValue(nextValue: string) {
    const normalized = normalizeHexInput(nextValue);

    setDraftState({
      source: normalizedValue,
      draft: nextValue.toUpperCase(),
    });

    if (normalized) {
      onChange(normalized);
    }
  }

  return (
    <label
      className={`block rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-3 ${className}`}
    >
      <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="h-12 w-14 shrink-0 rounded-2xl border border-[var(--dmi-border)] shadow-inner"
          style={{ backgroundColor: normalizedValue }}
          aria-hidden="true"
        />
        <input
          type="color"
          value={normalizedValue}
          onChange={(event) => commitValue(event.target.value)}
          className="h-12 w-14 shrink-0 cursor-pointer rounded-2xl border border-[var(--dmi-border)] bg-transparent p-1"
          aria-label={`${label} colour picker`}
        />
        <input
          value={inputValue}
          onChange={(event) => commitValue(event.target.value)}
          onBlur={() =>
            setDraftState({
              source: normalizedValue,
              draft: normalizedValue,
            })
          }
          className={`h-12 min-w-[8.5rem] flex-1 rounded-2xl border bg-[var(--input-bg)] px-4 text-sm font-semibold uppercase tracking-[0.04em] text-[var(--input-text)] outline-none transition focus:border-[var(--input-focus)] focus:ring-4 focus:ring-[var(--input-focus-ring)] ${
            validInput ? "border-[var(--input-border)]" : "border-red-400"
          }`}
          aria-invalid={!validInput}
          aria-label={`${label} HEX value`}
        />
      </div>
      {helperText && (
        <span className="mt-2 block text-xs leading-5 text-[var(--text-secondary)]">
          {helperText}
        </span>
      )}
    </label>
  );
}
