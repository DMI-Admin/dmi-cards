"use client";
import { useEffect, useLayoutEffect, useState, useRef, type ImgHTMLAttributes } from "react";
import { supabase } from "@/lib/supabase";
import { mediaAssetId, resolveCardMedia } from "@/lib/card-media";
import { createPrivateMediaLoader } from "@/lib/client-media-request";

const loadPrivateMedia = createPrivateMediaLoader(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}, (...args) => fetch(...args));

export default function CardMediaImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const imageRef = useRef<HTMLImageElement>(null);
  const raw = typeof src === "string" ? src : "";
  const asset = mediaAssetId(raw);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ asset: string; url: string } | null>(null);
  useLayoutEffect(() => {
    const image = imageRef.current;
    const fail = () => setFailedSource(raw);
    image?.addEventListener("card-media-timeout", fail);
    return () => image?.removeEventListener("card-media-timeout", fail);
  }, [raw]);
  useEffect(() => {
    if (!asset) return;
    let cancelled = false; let objectUrl = "";
    void (async () => {
      const blob = await loadPrivateMedia(raw);
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob); setPreview({ asset, url: objectUrl });
    })().catch(() => { if (!cancelled) setFailedSource(raw); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset, raw]);
  const resolved = asset ? (preview?.asset === asset ? preview.url : "") : resolveCardMedia(raw);
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} ref={imageRef} data-card-media={raw ? raw : undefined}
    loading="eager"
    fetchPriority={raw.startsWith("/api/public/cards/") ? "high" : props.fetchPriority}
    alt={alt || ""} src={resolved || undefined}
    data-media-unavailable={failedSource === raw || (!resolved && !asset) ? true : undefined}
    style={failedSource === raw || (!resolved && !asset) ? { ...props.style, display: "none" } : !resolved ? { ...props.style, visibility: "hidden" } : props.style}
    onError={(event) => { setFailedSource(raw); props.onError?.(event); }} />;
}
