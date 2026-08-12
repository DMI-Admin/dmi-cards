"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";

export const upgradeToProEventName = "dmi:open-upgrade-to-pro";

export function openUpgradeToProModal() {
  window.dispatchEvent(new CustomEvent(upgradeToProEventName));
}

type UpgradeToProButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  children: ReactNode;
};

export default function UpgradeToProButton({
  children,
  onClick,
  ...props
}: UpgradeToProButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);

    if (!event.defaultPrevented) {
      openUpgradeToProModal();
    }
  }

  return (
    <button type="button" {...props} onClick={handleClick}>
      {children}
    </button>
  );
}
