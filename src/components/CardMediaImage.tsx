"use client";
import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { supabase } from "@/lib/supabase";
import { mediaAssetId, resolveCardMedia } from "@/lib/card-media";
import { createPrivateMediaLoader } from "@/lib/client-media-request";

const loadPrivateMedia = createPrivateMediaLoader(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}, (...args) => fetch(...args));

export default function CardMediaImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const raw = typeof src === "string" ? src : "";
  const asset = mediaAssetId(raw);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ asset: string; url: string } | null>(null);
  useEffect(() => {
    if (!asset) return;
    let cancelled = false; let objectUrl = "";
    void (async () => {
      const blob = await loadPrivateMedia(raw);
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob); setPreview({ asset, url: objectUrl });
      setFailedSource(null);
    })().catch(() => { if (!cancelled) setFailedSource(raw); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset, raw]);
  const resolved = asset ? (preview?.asset === asset ? preview.url : "") : resolveCardMedia(raw);
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props}
    loading={raw.startsWith("/api/public/cards/") ? "eager" : props.loading}
    fetchPriority={raw.startsWith("/api/public/cards/") ? "high" : props.fetchPriority}
    alt={alt || ""} src={resolved || undefined}
    data-media-unavailable={failedSource === raw || !resolved ? true : undefined}
    style={failedSource === raw || !resolved ? { ...props.style, display: "none" } : props.style}
    onError={(event) => { setFailedSource(raw); props.onError?.(event); }} />;
}
