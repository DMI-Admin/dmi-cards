"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import UpgradeToProModal from "@/components/UpgradeToProModal";
import { upgradeToProEventName } from "@/components/UpgradeToProButton";

export default function UpgradeToProProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeModal = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function handleOpenUpgradeModal() {
      setOpen(true);
    }

    window.addEventListener(upgradeToProEventName, handleOpenUpgradeModal);

    return () => {
      window.removeEventListener(upgradeToProEventName, handleOpenUpgradeModal);
    };
  }, []);

  return (
    <>
      {children}
      <UpgradeToProModal open={open} onClose={closeModal} />
    </>
  );
}
