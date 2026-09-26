"use client";

import { compareTemplateLayouts, getTemplateLayout, canCreateTemplateLayout } from "@/lib/template-layouts";
import { useAdminInteraction } from "@/components/AdminInteractionDialog";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import CardRenderer from "@/components/CardRenderer";
import {
  deleteAdminTemplate,
  getAdminTemplates,
  publishAdminTemplate,
  saveAdminTemplate,
  type SharedTemplate,
} from "@/lib/templates";

type CustomFields = Partial<
  Record<"personal" | "company" | "contact" | "social", string[]>
>;

export default function CurrentTemplatesPage() {
  const interaction = useAdminInteraction();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const actionLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<SharedTemplate[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<Record<string, string>>({ free: "", paid: "", other: "" });
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateError, setTemplateError] = useState("");

  const templateGroups = useMemo(
    () => (["free", "paid", "other"] as const).map((accessLevel) => ({
      accessLevel,
      label: accessLevel === "free" ? "Free" : accessLevel === "paid" ? "Paid" : "Other",
      templates: templates
        .filter((template) => (template.access_level === "free" || template.access_level === "paid" ? template.access_level : "other") === accessLevel)
        .filter(template => [template.name, template.slug, template.layout_type, getTemplateLayout(template.layout_type)?.displayName].some(value => value?.toLowerCase().includes(search.toLowerCase())))
        .sort(compareTemplateLayouts),
    })),
    [templates, search]
  );

  async function fetchTemplates() {
    setLoading(true);
    try {
      const loadedTemplates = await getAdminTemplates({ raw: true });
      setTemplates(loadedTemplates);
      setTemplateError("");
    } catch (error) {
      console.error("Template load failed", error);
      setTemplateError(
        error instanceof Error
          ? error.message
          : "Templates could not be loaded from Supabase."
      );
      setTemplates([]);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    let ignore = false;

    async function loadTemplates() {
      try {
        const loadedTemplates = await getAdminTemplates({ raw: true });

        if (ignore) return;

        setTemplates(loadedTemplates);
        setTemplateError("");
      } catch (error) {
        if (ignore) return;

        console.error("Template load failed", error);
        setTemplateError(
          error instanceof Error
            ? error.message
            : "Templates could not be loaded from Supabase."
        );
      } finally { if (!ignore) setLoading(false); }
    }

    void loadTemplates();

    return () => {
      ignore = true;
    };
  }, []);

  function editTemplate(template: SharedTemplate) {
    router.push(`/templates?edit=${encodeURIComponent(template.id)}`);
  }

  async function duplicateTemplate(template: SharedTemplate) {
    if (busy || actionLock.current) return;
    if (!canCreateTemplateLayout(template)) { setTemplateError("Legacy or unknown layouts cannot be duplicated into new templates."); return; }
    const newName = (await interaction.prompt("Name for the duplicate template", `${template.name} Copy`))?.trim();
    if (!newName) return;
    const newSlug = `${slugify(newName) || "template"}-${crypto.randomUUID()}`;
    const draft: Partial<SharedTemplate> = { ...template };
    for (const key of ["id", "created_at", "updated_at", "usage_count", "supports_gradient", "font_family"] as const) delete draft[key];

    try {
      actionLock.current = true;
      setBusy(true);
      await saveAdminTemplate({
        ...draft,
        name: newName,
        slug: newSlug,
        is_published: false,
        status: "draft",
        usage_count: 0,
      });
      setTemplateMessage("Template duplicated successfully.");
      setTemplateError("");
      await fetchTemplates();
    } catch (error) {
      console.error("Template duplicate failed", error);
      setTemplateError(
        error instanceof Error
          ? error.message
          : "Template could not be duplicated. Please try again."
      );
    } finally { actionLock.current = false; setBusy(false); }
  }

  async function togglePublished(template: SharedTemplate) {
    if (busy || actionLock.current) return;
    const published = template.is_published || template.status === "published";
    if (!(await interaction.confirm(`${published ? "Unpublish" : "Publish"} template "${template.name}"? ${published ? "Existing saved cards retain this template." : "This changes catalogue availability."}`))) return;
    try {
      actionLock.current = true;
      setBusy(true);
      const result = await publishAdminTemplate(template, !published);
      setTemplates((current) =>
        current.map((item) =>
          item.id === template.id ? { ...item, is_published: !published, status: !published ? "published" : "draft" } : item
        )
      );
      setTemplateMessage(
        `Template ${result.template?.is_published ? "published" : "unpublished"}.`
      );
      setTemplateError("");
    } catch (error) {
      console.error("Template publish failed", error);
      setTemplateError(
        error instanceof Error
          ? error.message
          : "Template publish state could not be updated. Please try again."
      );
    } finally { actionLock.current = false; setBusy(false); }
  }

  async function deleteTemplate(template: SharedTemplate) {
    if (busy || actionLock.current) return;
    const confirmed = await interaction.confirm(
      `Delete template "${template.name}"? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
      actionLock.current = true;
      setBusy(true);
      await deleteAdminTemplate(template.id);
      setTemplates((current) =>
        current.filter((currentTemplate) => currentTemplate.id !== template.id)
      );
      setTemplateMessage("Template deleted successfully.");
      setTemplateError("");
    } catch (error) {
      console.error("Template delete failed", error);
      setTemplateError(
        error instanceof Error
          ? error.message
          : "Template could not be deleted. Please try again."
      );
    } finally { actionLock.current = false; setBusy(false); }
  }

  return (
    <main className="dmi-app-shell flex min-h-screen">
      <Sidebar />
      {interaction.dialog}

      <section className="dmi-page space-y-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-[var(--dmi-muted)]">
              Management
            </p>
            <h1 className="mt-2 text-4xl font-semibold">Current Templates</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--dmi-muted)]">
              Edit, duplicate, publish and delete templates from the
              Admin-managed catalogue.
            </p>
          </div>
        </div>

        <label className="block text-sm">Search templates
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} className="inputStyle mt-2 w-full" placeholder="Name, slug or layout" />
        </label>
        {templateError && (
          <div className="rounded-2xl border border-[var(--error)] bg-[var(--error-bg)] px-4 py-3 text-sm text-[var(--text-primary)]">
            {templateError}
          </div>
        )}

        {templateMessage && (
          <div className="rounded-2xl border border-[var(--success)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--text-primary)]">
            {templateMessage}
          </div>
        )}

        {templateGroups.map(({ accessLevel, label, templates: groupTemplates }) => {
          if (accessLevel === "other" && groupTemplates.length === 0) return null;
          // A deleted selection falls back to All without changing any action handler.
          const selectedId = groupTemplates.some(
            (template) => template.id === selectedTemplates[accessLevel]
          ) ? selectedTemplates[accessLevel] : "";
          const visibleTemplates = selectedId
            ? groupTemplates.filter((template) => template.id === selectedId)
            : groupTemplates;

          return (
            <section
              key={accessLevel}
              aria-labelledby={`${accessLevel}-templates-heading`}
              className="rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)]"
            >
              <div className="flex flex-col gap-4 border-b border-[var(--dmi-border)] p-4 sm:p-6 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <h2 id={`${accessLevel}-templates-heading`} className="text-2xl font-semibold">
                    {label} Templates
                  </h2>
                  <span className="shrink-0 rounded-full bg-[var(--dmi-surface-soft)] px-3 py-1 text-xs font-medium text-[var(--dmi-muted)]">
                    {groupTemplates.length}
                  </span>
                </div>

                <div className="relative w-full md:w-64 md:shrink-0">
                  <label htmlFor={`${accessLevel}-template-filter`} className="sr-only">
                    Filter {label} templates
                  </label>
                  <select
                    id={`${accessLevel}-template-filter`}
                    value={selectedId}
                    onChange={(event) => setSelectedTemplates((current) => ({
                      ...current,
                      [accessLevel]: event.target.value,
                    }))}
                    className="inputStyle w-full min-w-0 bg-[var(--input-bg)] pr-10 text-[var(--input-text)]"
                  >
                    <option value="">All {label} Templates</option>
                    {groupTemplates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--dmi-muted)]"
                  />
                </div>
              </div>

              <div className="p-4 sm:p-6">
                {loading ? <p role="status" className="p-6 text-[var(--dmi-muted)]">Loading templates…</p> : templateError && groupTemplates.length === 0 ? <p role="alert" className="p-6 text-[var(--error)]">Templates unavailable. <button className="underline" onClick={() => void fetchTemplates()}>Retry loading</button></p> : visibleTemplates.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[var(--dmi-muted)]">
                    No {label} templates yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap justify-center gap-6">
                    {visibleTemplates.map((template) => (
                      <div
                        key={template.id}
                        className="w-full min-w-0 max-w-[260px] rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-3 transition hover:border-[var(--border-brand)]"
                      >
                        <div className="mb-3 flex h-36 items-start justify-center overflow-hidden rounded-xl bg-[#070B1A]/60">
                          <div className="mx-auto origin-top scale-[0.28]">
                            <div className="mx-auto w-[560px]">
                              <CardRenderer
                                mode="compact"
                                template={template}
                                cardData={{
                                  title: "Dr",
                                  first_name: "First Name",
                                  last_name: "Last Name",
                                  full_name: "Full Name",
                                  job_title: "Creative Director",
                                  bio: "Professional bio",
                                  company_name: "DevMaster Inc",
                                  department: "Creative Department",
                                  email: "hello@devmasterinc.com",
                                  phone: "+44 7000 000000",
                                  website: "devmasterinc.com",
                                  address: "London, United Kingdom",
                                  custom_fields: previewCustomFieldValues(
                                    template.custom_fields || {}
                                  ),
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold">
                              {template.name}
                            </h2>
                            <p className="text-xs text-[var(--dmi-muted)]">{getTemplateLayout(template.layout_type)?.displayName || `${template.layout_type || "Unknown"} (legacy/unknown)`}</p>
                          </div>

                          <AccessBadge level={template.access_level || "unknown"} />
                        </div>

                        <div className="mt-3 border-t border-[var(--dmi-border)] pt-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs ${
                              (template.is_published || template.status === "published")
                                ? "bg-[var(--success-bg)] text-[var(--text-primary)]"
                                : "bg-[var(--badge-neutral-bg)] text-[var(--badge-neutral-text)]"
                            }`}
                          >
                            {(template.is_published || template.status === "published") ? "Published" : "Draft"}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => editTemplate(template)}
                            className="rounded-lg bg-[var(--button-secondary-bg)] py-2 text-xs text-[var(--button-secondary-text)] hover:bg-[var(--button-hover-bg)]"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => duplicateTemplate(template)}
                            className="rounded-lg bg-[var(--button-secondary-bg)] py-2 text-xs text-[var(--button-secondary-text)] hover:bg-[var(--button-hover-bg)]"
                          >
                            Duplicate
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => togglePublished(template)}
                            className="rounded-lg bg-[#AC00FF] py-2 text-xs !text-white hover:opacity-90"
                          >
                            {(template.is_published || template.status === "published") ? "Unpublish" : "Publish"}
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => deleteTemplate(template)}
                            className="rounded-lg bg-[var(--button-secondary-bg)] py-2 text-xs text-[var(--button-secondary-text)] hover:bg-[var(--error-bg)]"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </section>
    </main>
  );
}

function previewCustomFieldValues(customFields: CustomFields) {
  return Object.values(customFields)
    .flat()
    .filter((field): field is string => typeof field === "string")
    .filter((field) => field.startsWith("custom:"))
    .reduce<Record<string, string>>((values, label) => {
      values[formatFieldLabel(label)] = `${formatFieldLabel(label)} details`;
      return values;
    }, {});
}

function formatFieldLabel(field: string) {
  if (field.startsWith("custom:")) {
    return field.split(":").at(-1) || field;
  }

  return field.replaceAll("_", " ");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replaceAll(" ", "-")
    .replace(/[^a-z0-9-]/g, "");
}

function AccessBadge({ level }: { level: string }) {
  const displayLevel = level === "free" ? "Free" : level === "paid" ? "Paid" : "Unknown";
  const styles =
    displayLevel === "Free"
      ? "border-[var(--border-strong)] bg-transparent text-[var(--text-primary)]"
      : "border-amber-500 bg-amber-400 text-amber-950";

  return (
    <span className={`inline-flex h-7 w-16 shrink-0 items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold leading-none ${styles}`}>
      {displayLevel}
    </span>
  );
}
