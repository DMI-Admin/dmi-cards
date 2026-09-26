"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminDialog } from "@/hooks/useAdminDialog";

type Request = { message: string; initial?: string; resolve: (value: string | null) => void };

// Same values as native dialogs: Cancel -> null/false; OK -> entered text/true.
export function useAdminInteraction() {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  const ask = useCallback((message: string, initial?: string) => new Promise<string | null>(resolve => {
    if (pending.current) { resolve(null); return; }
    const next = { message, initial, resolve };
    pending.current = next;
    setRequest(next);
  }), []);
  const finish = useCallback((value: string | null) => {
    const current = pending.current;
    pending.current = null;
    setRequest(null);
    current?.resolve(value);
  }, []);
  useEffect(() => () => { pending.current?.resolve(null); pending.current = null; }, []);
  return {
    confirm: (message: string) => ask(message).then(value => value !== null),
    prompt: (message: string, initial = "") => ask(message, initial),
    dialog: request ? createPortal(<InteractionDialog key={request.message} request={request} finish={finish} />, document.body) : null,
  };
}

function InteractionDialog({ request, finish }: { request: Request; finish: (value: string | null) => void }) {
  const dialog = useAdminDialog(() => finish(null));
  const [value, setValue] = useState(request.initial ?? "");
  const isPrompt = request.initial !== undefined;
  return (
    <div {...dialog} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm">
      <form onSubmit={event => { event.preventDefault(); finish(isPrompt ? value : "confirmed"); }} className="w-full max-w-md rounded-[24px] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 text-[var(--text-primary)] shadow-2xl sm:p-6">
        <h2 className="text-xl font-semibold">{request.message}</h2>
        {isPrompt && <input data-dialog-initial-focus aria-label={request.message} value={value} onChange={event => setValue(event.target.value)} className="inputStyle mt-4 w-full" />}
        <div className="mt-6 flex justify-end gap-3">
          <button data-dialog-initial-focus={!isPrompt ? "" : undefined} type="button" onClick={() => finish(null)} className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--button-secondary-bg)] px-5 py-3 font-semibold text-[var(--button-secondary-text)]">Cancel</button>
          <button type="submit" className="rounded-2xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] px-5 py-3 font-semibold !text-white">OK</button>
        </div>
      </form>
    </div>
  );
}
