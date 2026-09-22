/** Observe only actual rendered media. Never mutate card data or media intents. */
export function watchCardImages(root: HTMLElement, reveal: (ready: boolean) => void) {
  type Entry = { source: string; settled: boolean; fail: () => void; cleanup: () => void };
  const entries = new Map<HTMLImageElement, Entry>();
  let resourceIndex = 0;
  let disposed = false;
  let frame = 0;
  const mark = (name: string) => {
    performance.clearMarks(`dmi-card:${name}`);
    performance.mark(`dmi-card:${name}`);
  };
  const check = () => {
    cancelAnimationFrame(frame);
    if ([...entries.values()].some(entry => !entry.settled)) { reveal(false); return; }
    // Allow failed-image state/wrapper collapse to commit before revealing.
    frame = requestAnimationFrame(() => { if (!disposed) { mark("reveal"); reveal(true); } });
  };
  const scan = () => {
    const images = new Set(root.querySelectorAll<HTMLImageElement>("img[data-card-media]"));
    for (const [image, entry] of entries) {
      if (!images.has(image) || image.dataset.cardMedia !== entry.source) {
        entry.cleanup(); entries.delete(image);
      }
    }
    for (const image of images) {
      const existing = entries.get(image);
      if (existing) { if (image.dataset.mediaUnavailable) existing.fail(); continue; }
      const source = image.dataset.cardMedia || "";
      if (!source) continue;
      const entry: Entry = { source, settled: false, fail: () => {}, cleanup: () => {} };
      entries.set(image, entry);
      const resource = ++resourceIndex;
      mark(`image-${resource}:observed`);
      let active = true;
      const settle = (failed: boolean) => {
        if (!active || entry.settled || image.dataset.cardMedia !== source) return;
        entry.settled = true;
        clearTimeout(timer);
        if (failed) image.dispatchEvent(new Event("card-media-timeout"));
        mark(`image-${resource}:${failed ? "unavailable" : "decoded"}`);
        check();
      };
      const loaded = () => {
        if (!image.getAttribute("src") || !image.naturalWidth) return;
        mark(`image-${resource}:loaded`);
        // Timing metadata only: never emit the URL, token, or image contents.
        const request = performance.getEntriesByName?.(image.currentSrc, "resource").at(-1);
        if (request) {
          performance.clearMarks(`dmi-card:image-${resource}:request-start`);
          performance.mark(`dmi-card:image-${resource}:request-start`, { startTime: request.startTime });
        }
        void image.decode().then(() => settle(false), () => settle(true));
      };
      const failed = () => settle(true);
      entry.fail = failed;
      const timer = setTimeout(failed, 3000);
      image.addEventListener("load", loaded);
      image.addEventListener("error", failed);
      entry.cleanup = () => { active = false; clearTimeout(timer); image.removeEventListener("load", loaded); image.removeEventListener("error", failed); };
      if (image.complete && image.naturalWidth) loaded();
      else if (image.dataset.mediaUnavailable && image.getAttribute("src")) failed();
    }
    check();
  };
  const observer = new MutationObserver(scan);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "data-card-media", "data-media-unavailable"] });
  scan();
  const dispose = () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); for (const entry of entries.values()) entry.cleanup(); };
  return Object.assign(dispose, { refresh: scan });
}
