"use client";

import { useMemo, useState, type FormEvent } from "react";
import CardRenderer, {
  displayName,
  type CardRendererData,
  type CardRendererTemplate,
} from "@/components/CardRenderer";
import {
  defaultLeadCaptureSettings,
  normalizeLeadCaptureSettings,
  type LeadCaptureSettings,
  type LeadField,
} from "@/lib/services/card-payload";

type PublicCardExperienceProps = {
  slug: string;
  card: CardRendererData;
  template: CardRendererTemplate;
  leadCaptureSettings: LeadCaptureSettings;
};

const fieldLabels: Record<LeadField, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  job_title: "Job title",
  website: "Website",
  message: "Message",
};

const fieldPlaceholders: Record<LeadField, string> = {
  name: "Your name",
  email: "you@example.com",
  phone: "Phone number",
  company: "Company name",
  job_title: "Job title",
  website: "https://example.com",
  message: "How can they help?",
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const recipient = card.company_name || displayName(card, "this card owner");
  const privacyNotice =
    settings.consent_notice ||
    `Your details will be shared with ${recipient} so they can respond to your enquiry.`;
  const privacyUrl = settings.privacy_policy_url || settings.terms_url;

  if (revealed) {
    return <CardRenderer mode="public" template={template} cardData={card} />;
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
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error?.message || "Could not submit your details. Please try again."
        );
      }

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
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 text-white shadow-2xl shadow-black/30 backdrop-blur">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
          Contact details
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Share your details</h1>
        <p className="mt-3 text-sm leading-6 text-white/65">
          {privacyNotice}
        </p>
        {privacyUrl && isSafePublicUrl(privacyUrl) && (
          <a
            href={privacyUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex text-sm font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
          >
            Privacy Policy
          </a>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {settings.fields.length === 0 ? (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm text-amber-50">
            This card is not ready to collect details yet.
          </div>
        ) : (
          settings.fields.map((field) => (
            <label key={field} className="block">
              <span className="mb-1.5 block text-sm font-semibold text-white/75">
                {fieldLabels[field]}
              </span>
              {field === "message" ? (
                <textarea
                  value={values[field] || ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                  rows={4}
                  maxLength={2000}
                  placeholder={fieldPlaceholders[field]}
                  className="w-full resize-none rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm text-[#0F172A] outline-none placeholder:text-slate-400 focus:border-white/60 focus:ring-4 focus:ring-white/15"
                />
              ) : (
                <input
                  value={values[field] || ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                  type={inputTypeForField(field)}
                  maxLength={maxLengthForField(field)}
                  placeholder={fieldPlaceholders[field]}
                  className="w-full rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm text-[#0F172A] outline-none placeholder:text-slate-400 focus:border-white/60 focus:ring-4 focus:ring-white/15"
                />
              )}
            </label>
          ))
        )}

        {settings.marketing_opt_in_enabled && (
          <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-white/70">
            <input
              type="checkbox"
              checked={marketingOptedIn}
              onChange={(event) => setMarketingOptedIn(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-white/25"
            />
            <span>
              {settings.marketing_opt_in_label ||
                defaultLeadCaptureSettings.marketing_opt_in_label}
            </span>
          </label>
        )}

        {error && (
          <div className="rounded-2xl border border-red-300/25 bg-red-500/10 p-3 text-sm text-red-50">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || settings.fields.length === 0}
          className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-white px-5 text-sm font-bold text-[#070B1A] transition hover:bg-white/90 focus:outline-none focus:ring-4 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Continue to card"}
        </button>
      </form>
    </section>
  );
}

function inputTypeForField(field: LeadField) {
  if (field === "email") return "email";
  if (field === "phone") return "tel";
  if (field === "website") return "url";
  return "text";
}

function maxLengthForField(field: LeadField) {
  const limits: Record<LeadField, number> = {
    name: 180,
    email: 254,
    phone: 60,
    company: 180,
    job_title: 180,
    website: 2048,
    message: 2000,
  };

  return limits[field];
}

function isSafePublicUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
