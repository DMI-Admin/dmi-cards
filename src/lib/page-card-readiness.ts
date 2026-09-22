"use client";
import { createContext } from "react";

export const PageCardReadiness = createContext<((id: string, ready: boolean) => void) | null>(null);
export const CardReadinessReporter = createContext<((ready: boolean) => void) | null>(null);

export function initialCardsSettled(resolved: boolean, expected: readonly string[], reports: ReadonlyMap<string, boolean>) {
  return resolved && expected.every(id => reports.get(id) === true);
}
