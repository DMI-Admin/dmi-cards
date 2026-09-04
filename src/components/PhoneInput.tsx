"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { CountryCode } from "libphonenumber-js";
import { ChevronDown, Search } from "lucide-react";

import {
  countryForPhoneNumber,
  defaultPhoneCountry,
  formatPhoneNumberForInput,
  nationalPhoneNumberForInput,
  normalizeInternationalPhoneNumber,
  type PhoneCountryOption,
  phoneCountryOptions,
} from "@/lib/phone-number";

type PhoneInputProps = {
  label: string;
  helperText?: string;
  value?: string | null;
  onChange: (value: string) => void;
};

type DropdownPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export default function PhoneInput({
  label,
  helperText,
  value,
  onChange,
}: PhoneInputProps) {
  const labelId = useId();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const initialCountry = useMemo(() => countryForValue(value), [value]);
  const [country, setCountry] = useState<CountryCode>(initialCountry);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] =
    useState<DropdownPosition | null>(null);
  const selectedCountry = explicitCountryForValue(value) || country;
  const selectedOption =
    phoneCountryOptions.find((option) => option.code === selectedCountry) ||
    phoneCountryOptions[0];
  const displayValue = nationalPhoneNumberForInput(value, selectedCountry);
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return phoneCountryOptions;

    return phoneCountryOptions.filter((option) =>
      option.searchText.includes(query)
    );
  }, [search]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;

      if (
        !rootRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleViewportChange() {
      const nextPosition = positionForTrigger(triggerRef.current);
      if (nextPosition) {
        setDropdownPosition(nextPosition);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function commitPhone(nextValue: string, nextCountry = selectedCountry) {
    const normalized = normalizeInternationalPhoneNumber(nextValue, nextCountry);
    onChange(normalized || nextValue);
  }

  function toggleDropdown() {
    const nextOpen = !open;
    if (nextOpen) {
      setDropdownPosition(positionForTrigger(triggerRef.current));
    }

    setOpen(nextOpen);
  }

  function handleCountryChange(nextCountry: CountryCode) {
    setCountry(nextCountry);
    setOpen(false);
    setSearch("");
    setHighlightedIndex(0);

    if (displayValue.trim()) {
      commitPhone(displayValue, nextCountry);
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredOptions.length === 0) return;
      setHighlightedIndex((current) =>
        Math.min(current + 1, filteredOptions.length - 1)
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredOptions.length === 0) return;
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[highlightedIndex];
      if (option) handleCountryChange(option.code);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="block" ref={rootRef}>
      <span
        id={labelId}
        className="mb-2 block text-sm font-medium text-[var(--text-secondary)]"
      >
        {label}
      </span>
      <div className="grid gap-2 sm:grid-cols-[7.25rem_minmax(0,1fr)]">
        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={toggleDropdown}
            className="flex h-12 w-full items-center justify-between gap-2 rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm font-semibold text-[var(--input-text)] outline-none transition hover:border-[var(--border-brand)] focus:border-[var(--input-focus)] focus:ring-4 focus:ring-[var(--input-focus-ring)]"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-label={`${label} country, ${selectedOption.name} ${selectedOption.dialCode}`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden="true">{selectedOption.flag}</span>
              <span>{selectedOption.dialCode}</span>
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform ${
                open ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            />
          </button>
        </div>
        <input
          value={displayValue}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          onBlur={(event) => commitPhone(event.target.value)}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={formatPhoneNumberForInput("07770248834", selectedCountry)}
          className="h-12 w-full rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-sm text-[var(--input-text)] outline-none transition placeholder:text-[var(--dmi-text-tertiary)] focus:border-[var(--input-focus)] focus:ring-4 focus:ring-[var(--input-focus-ring)]"
          aria-labelledby={labelId}
        />
      </div>
      {helperText && (
        <span className="mt-2 block text-xs leading-5 text-[var(--text-secondary)]">
          {helperText}
        </span>
      )}
      {open && dropdownPosition && typeof document !== "undefined"
        ? createPortal(
            <CountryDropdown
              ref={dropdownRef}
              label={label}
              listboxId={listboxId}
              selectedCountry={selectedCountry}
              filteredOptions={filteredOptions}
              highlightedIndex={highlightedIndex}
              search={search}
              position={dropdownPosition}
              onSearchChange={(nextSearch) => {
                setSearch(nextSearch);
                setHighlightedIndex(0);
              }}
              onSearchKeyDown={handleSearchKeyDown}
              onHighlight={setHighlightedIndex}
              onSelect={handleCountryChange}
            />,
            document.body
          )
        : null}
    </div>
  );
}

const CountryDropdown = forwardRef<
  HTMLDivElement,
  {
    label: string;
    listboxId: string;
    selectedCountry: CountryCode;
    filteredOptions: PhoneCountryOption[];
    highlightedIndex: number;
    search: string;
    position: DropdownPosition;
    onSearchChange: (value: string) => void;
    onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    onHighlight: (index: number) => void;
    onSelect: (country: CountryCode) => void;
  }
>(function CountryDropdown(
  {
    label,
    listboxId,
    selectedCountry,
    filteredOptions,
    highlightedIndex,
    search,
    position,
    onSearchChange,
    onSearchKeyDown,
    onHighlight,
    onSelect,
  },
  ref
) {
  return (
    <div
      ref={ref}
      className="fixed z-[9999] overflow-hidden rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] shadow-[0_24px_70px_rgba(0,0,0,0.28)]"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
    >
      <div className="sticky top-0 z-10 border-b border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-2">
        <div className="flex h-10 items-center gap-2 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-[var(--text-secondary)]">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={onSearchKeyDown}
            autoFocus
            placeholder="Search country or code"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-[var(--input-text)] outline-none placeholder:text-[var(--dmi-text-tertiary)]"
            aria-label="Search countries"
          />
        </div>
      </div>
      <div
        id={listboxId}
        role="listbox"
        aria-label={`${label} country options`}
        className="max-h-80 overflow-y-auto p-1"
      >
        {filteredOptions.length > 0 ? (
          filteredOptions.map((option, index) => (
            <button
              key={option.code}
              type="button"
              role="option"
              aria-selected={option.code === selectedCountry}
              onMouseEnter={() => onHighlight(index)}
              onClick={() => onSelect(option.code)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                option.code === selectedCountry || index === highlightedIndex
                  ? "bg-[var(--button-hover-bg)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span className="text-base" aria-hidden="true">
                {option.flag}
              </span>
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              <span className="shrink-0 font-semibold">{option.dialCode}</span>
            </button>
          ))
        ) : (
          <p className="px-3 py-4 text-sm text-[var(--text-secondary)]">
            No countries found.
          </p>
        )}
      </div>
    </div>
  );
});

function positionForTrigger(trigger: HTMLButtonElement | null): DropdownPosition | null {
  if (!trigger || typeof window === "undefined") return null;

  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 16;
  const gap = 8;
  const preferredWidth = 360;
  const width = Math.min(
    Math.max(preferredWidth, rect.width),
    viewportWidth - margin * 2
  );
  const left = Math.min(
    Math.max(rect.left, margin),
    Math.max(margin, viewportWidth - width - margin)
  );
  const spaceBelow = viewportHeight - rect.bottom - margin - gap;
  const spaceAbove = rect.top - margin - gap;
  const maxHeight = Math.min(384, Math.max(240, Math.max(spaceBelow, spaceAbove)));
  const opensAbove = spaceBelow < 260 && spaceAbove > spaceBelow;
  const top = opensAbove
    ? Math.max(margin, rect.top - gap - maxHeight)
    : Math.min(rect.bottom + gap, viewportHeight - margin - maxHeight);

  return { top, left, width, maxHeight };
}

function countryForValue(value: string | null | undefined): CountryCode {
  return countryForPhoneNumber(value, defaultPhoneCountry);
}

function explicitCountryForValue(value: string | null | undefined) {
  const compact = value?.trim().replace(/[\s().-]/g, "") || "";
  if (!compact.startsWith("+") && !compact.startsWith("00")) return null;

  return countryForValue(value);
}
