"use client";
import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { supabase } from "@/lib/supabase";
import { mediaAssetId, resolveCardMedia } from "@/lib/card-media";

export default function CardMediaImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const raw = typeof src === "string" ? src : "";
  const asset = mediaAssetId(raw);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ asset: string; url: string } | null>(null);
  useEffect(() => {
    if (!asset) return;
    let cancelled = false; let objectUrl = "";
    const controller = new AbortController();
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (!cancelled) setFailedSource(raw); return; }
      const response = await fetch(resolveCardMedia(raw), { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal: controller.signal });
      if (!response.ok) { if (!cancelled) setFailedSource(raw); return; }
      const blob = await response.blob();
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob); setPreview({ asset, url: objectUrl });
      setFailedSource(null);
    })().catch(() => { if (!cancelled) setFailedSource(raw); });
    return () => { cancelled = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
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
