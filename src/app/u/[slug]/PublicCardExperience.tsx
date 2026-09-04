"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import CardRenderer, {
  displayName,
  type CardRendererData,
  type CardRendererTemplate,
} from "@/components/CardRenderer";
import PublicLeadCaptureForm from "@/components/PublicLeadCaptureForm";
import {
  normalizeLeadCaptureSettings,
  type LeadCaptureSettings,
} from "@/lib/services/card-payload";

type PublicCardExperienceProps = {
  slug: string;
  card: CardRendererData & {
    id?: string | null;
  };
  template: CardRendererTemplate;
  leadCaptureSettings: LeadCaptureSettings;
};

export default function PublicCardExperience({
  slug,
  card,
  template,
  leadCaptureSettings,
}: PublicCardExperienceProps) {
  const settings = useMemo(
    () => normalizeLeadCaptureSettings(leadCaptureSettings),
    [leadCaptureSettings]
  );
  const [revealed, setRevealed] = useState(settings.flow !== "collect_first");
  const [values, setValues] = useState<Record<string, string>>({});
  const [marketingOptedIn, setMarketingOptedIn] = useState(false);
  const [honeypotValue, setHoneypotValue] = useState("");
  const [formRenderedAt, setFormRenderedAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const completionStorageKey = useMemo(
    () =>
      card.id
        ? `dmi_collect_first_completed:${card.id}`
        : `dmi_collect_first_completed:slug:${slug}`,
    [card.id, slug]
  );
  const [completionChecked, setCompletionChecked] = useState(
    settings.flow !== "collect_first"
  );
  const recipient = card.company_name || displayName(card, "this card owner");
  const privacyNotice =
    settings.consent_notice ||
    `Your details will be shared with ${recipient} so they can respond to your enquiry.`;
  const privacyUrl = settings.privacy_policy_url || settings.terms_url;

  useEffect(() => {
    if (settings.flow !== "collect_first") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const completed = readCollectFirstCompletion(completionStorageKey);
      if (completed) {
        setRevealed(true);
      } else {
        setFormRenderedAt(String(Date.now()));
      }
      setCompletionChecked(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [completionStorageKey, settings.flow]);

  if (revealed) {
    return <CardRenderer mode="public" template={template} cardData={card} />;
  }

  if (!completionChecked) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch(`/api/public/cards/${encodeURIComponent(slug)}/leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: values,
          marketing_opted_in: marketingOptedIn,
          anti_bot: {
            website_confirm: honeypotValue,
            rendered_at: formRenderedAt,
          },
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error?.message || "Could not submit your details. Please try again."
        );
      }

      writeCollectFirstCompletion(completionStorageKey);
      setRevealed(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not submit your details. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PublicLeadCaptureForm
      settings={settings}
      privacyNotice={privacyNotice}
      privacyUrl={privacyUrl}
      values={values}
      marketingOptedIn={marketingOptedIn}
      submitting={submitting}
      error={error}
      honeypotValue={honeypotValue}
      renderedAt={formRenderedAt}
      onSubmit={handleSubmit}
      onValueChange={(key, value) =>
        setValues((current) => ({
          ...current,
          [key]: value,
        }))
      }
      onMarketingChange={setMarketingOptedIn}
      onHoneypotChange={setHoneypotValue}
    />
  );
}

function readCollectFirstCompletion(storageKey: string) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return false;
    const parsed = JSON.parse(stored) as { completed?: unknown };
    return parsed.completed === true;
  } catch {
    return false;
  }
}

function writeCollectFirstCompletion(storageKey: string | null) {
  if (!storageKey) return;

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        completed: true,
        timestamp: new Date().toISOString(),
      })
    );
  } catch {
    // Storage access can be unavailable in private/browser-restricted contexts.
  }
}
