"use client";

import type { FormEvent } from "react";
import {
  defaultLeadCaptureSettings,
  type LeadCaptureSettings,
  type LeadField,
} from "@/lib/services/card-payload";

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

type PublicLeadCaptureFormProps = {
  settings: LeadCaptureSettings;
  privacyNotice: string;
  privacyUrl?: string | null;
  values?: Record<string, string>;
  marketingOptedIn?: boolean;
  submitting?: boolean;
  error?: string;
  readOnly?: boolean;
  emptyFieldsMessage?: string;
  honeypotValue?: string;
  renderedAt?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onValueChange?: (key: string, value: string) => void;
  onMarketingChange?: (checked: boolean) => void;
  onHoneypotChange?: (value: string) => void;
};

export default function PublicLeadCaptureForm({
  settings,
  privacyNotice,
  privacyUrl,
  values = {},
  marketingOptedIn = false,
  submitting = false,
  error = "",
  readOnly = false,
  emptyFieldsMessage = "This card is not ready to collect details yet.",
  honeypotValue = "",
  renderedAt = "",
  onSubmit,
  onValueChange,
  onMarketingChange,
  onHoneypotChange,
}: PublicLeadCaptureFormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (readOnly || !onSubmit) {
      event.preventDefault();
      return;
    }

    onSubmit(event);
  }

  return (
    <section className="@container rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 text-white shadow-2xl shadow-black/30 backdrop-blur">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
          Contact details
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Share your details</h1>
        <p className="mt-3 text-sm leading-6 text-white/65">{privacyNotice}</p>
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
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
        >
          <label htmlFor="dmi-lead-website-confirm">Leave this field blank</label>
          <input
            id="dmi-lead-website-confirm"
            name="website_confirm"
            type="text"
            value={honeypotValue}
            onChange={(event) => onHoneypotChange?.(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
            readOnly={readOnly}
          />
          <input
            name="lead_form_rendered_at"
            type="hidden"
            value={renderedAt}
            readOnly
          />
        </div>

        {settings.fields.length === 0 ? (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm text-amber-50">
            {emptyFieldsMessage}
          </div>
        ) : (
          settings.fields.map((field) => (
            <LeadFieldInput
              key={field}
              field={field}
              values={values}
              readOnly={readOnly}
              onChange={(key, value) => onValueChange?.(key, value)}
            />
          ))
        )}

        {settings.marketing_opt_in_enabled && (
          <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-white/70">
            <input
              type="checkbox"
              checked={marketingOptedIn}
              readOnly={readOnly}
              onChange={(event) => onMarketingChange?.(event.target.checked)}
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
          type={readOnly ? "button" : "submit"}
          disabled={submitting || settings.fields.length === 0}
          className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-white px-5 text-sm font-bold text-[#070B1A] transition hover:bg-white/90 focus:outline-none focus:ring-4 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Continue to card"}
        </button>
      </form>
    </section>
  );
}

function LeadFieldInput({
  field,
  values,
  readOnly,
  onChange,
}: {
  field: LeadField;
  values: Record<string, string>;
  readOnly: boolean;
  onChange: (key: string, value: string) => void;
}) {
  if (field === "name") {
    return (
      <div className="grid gap-4 @lg:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-white/75">
            First name
          </span>
          <input
            value={values.first_name || ""}
            onChange={(event) => onChange("first_name", event.target.value)}
            type="text"
            autoComplete="given-name"
            maxLength={90}
            placeholder="First name"
            readOnly={readOnly}
            className="w-full rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm text-[#0F172A] outline-none placeholder:text-slate-400 focus:border-white/60 focus:ring-4 focus:ring-white/15"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-white/75">
            Last name
          </span>
          <input
            value={values.last_name || ""}
            onChange={(event) => onChange("last_name", event.target.value)}
            type="text"
            autoComplete="family-name"
            maxLength={90}
            placeholder="Last name"
            readOnly={readOnly}
            className="w-full rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm text-[#0F172A] outline-none placeholder:text-slate-400 focus:border-white/60 focus:ring-4 focus:ring-white/15"
          />
        </label>
      </div>
    );
  }

  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-white/75">
        {fieldLabels[field]}
      </span>
      {field === "message" ? (
        <textarea
          value={values[field] || ""}
          onChange={(event) => onChange(field, event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder={fieldPlaceholders[field]}
          readOnly={readOnly}
          className="w-full resize-none rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm text-[#0F172A] outline-none placeholder:text-slate-400 focus:border-white/60 focus:ring-4 focus:ring-white/15"
        />
      ) : (
        <input
          value={values[field] || ""}
          onChange={(event) => onChange(field, event.target.value)}
          type={inputTypeForField(field)}
          maxLength={maxLengthForField(field)}
          placeholder={fieldPlaceholders[field]}
          readOnly={readOnly}
          className="w-full rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm text-[#0F172A] outline-none placeholder:text-slate-400 focus:border-white/60 focus:ring-4 focus:ring-white/15"
        />
      )}
    </label>
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
