"use client";

import { useId, useLayoutEffect, useRef } from "react";

const layers: HTMLElement[] = [];
const background = new Map<HTMLElement, boolean>();

// Recompute for the topmost dialog so sibling/nested Admin overlays compose.
function isolateTopDialog() {
  for (const [element, inert] of background) element.inert = inert;
  background.clear();
  let branch = layers.at(-1);
  while (branch?.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        background.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    }
    branch = branch.parentElement;
    if (branch === document.body) break;
  }
}

const selector = 'button, [href], input, select, textarea, [tabindex], [contenteditable="true"]';
function focusable(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(element =>
    element.tabIndex >= 0 && !element.matches(':disabled') &&
    !element.closest('[inert], [hidden]') && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden'
  );
}

export function useAdminDialog(onClose?: () => void, canEscape = true, nestedDialog = false) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const options = useRef({ onClose, canEscape });
  useLayoutEffect(() => { options.current = { onClose, canEscape }; }, [onClose, canEscape]);
  useLayoutEffect(() => {
    const root = ref.current;
    const dialog = nestedDialog ? root?.querySelector<HTMLElement>('[role="dialog"]') : root;
    if (!dialog) return;
    if (nestedDialog) dialog.tabIndex = -1;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const title = dialog.querySelector('h1, h2, h3');
    if (title) {
      if (!title.id) title.id = titleId;
      dialog.setAttribute('aria-labelledby', title.id);
    }
    layers.push(dialog);
    isolateTopDialog();
    const focusInside = () => {
      const controls = focusable(dialog);
      const safe = controls.find(element => element.hasAttribute('data-dialog-initial-focus'));
      (safe || dialog).focus({ preventScroll: true });
    };
    focusInside();
    const onKeyDown = (event: KeyboardEvent) => {
      if (layers.at(-1) !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (options.current.canEscape) options.current.onClose?.();
      }
      if (event.key === 'Tab') {
        const controls = focusable(dialog);
        const index = controls.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        (controls[next] || dialog).focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (layers.at(-1) === dialog && !dialog.contains(event.target as Node)) focusInside();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus, true);
      const wasTop = layers.at(-1) === dialog;
      const index = layers.indexOf(dialog);
      if (index >= 0) layers.splice(index, 1);
      isolateTopDialog();
      if (wasTop && opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
      // Save/publish may re-enable the opener in the same React commit.
      requestAnimationFrame(() => {
        if (wasTop && !layers.length && opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
      });
    };
  }, [titleId, nestedDialog]);
  return { ref, role: 'dialog' as const, 'aria-modal': true as const, tabIndex: -1 };
}
