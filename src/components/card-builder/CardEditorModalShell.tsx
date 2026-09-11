"use client";

import NextImage from "next/image";
import { X } from "lucide-react";

export default function CardEditorModalShell({
  title,
  description,
  ariaLabel,
  children,
  actionBar,
  onClose,
}: {
  title: string;
  description?: string;
  ariaLabel: string;
  children: React.ReactNode;
  actionBar?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#070B1A]/55 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className="relative flex max-h-[calc(100vh-24px)] w-[min(1480px,calc(100vw-24px))] flex-col overflow-hidden rounded-3xl border border-[var(--dmi-border)] bg-[var(--background)] shadow-2xl shadow-black/40">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-raised)] shadow-sm">
              <NextImage
                src="/dmi-cards-logo.svg"
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 object-contain"
              />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-[var(--text-primary)]">
                {title}
              </h2>
              {description && (
                <p className="mt-0.5 truncate text-sm text-[var(--text-secondary)]">
                  {description}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${ariaLabel}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)] shadow-sm transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
          {children}
        </div>

        {actionBar}
      </div>
    </div>
  );
}
