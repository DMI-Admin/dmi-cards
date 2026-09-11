"use client";

import { useEffect, useMemo, useState } from "react";
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
  const router = useRouter();
  const [templates, setTemplates] = useState<SharedTemplate[]>([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateError, setTemplateError] = useState("");

  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();

    if (!query) return templates;

    return templates.filter((template) =>
      template.name.toLowerCase().includes(query)
    );
  }, [templateSearch, templates]);

  async function fetchTemplates() {
    try {
      const loadedTemplates = await getAdminTemplates();
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
    }
  }

  useEffect(() => {
    let ignore = false;

    async function loadTemplates() {
      try {
        const loadedTemplates = await getAdminTemplates();

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
      }
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
    const newName = `${template.name} Copy`;
    const newSlug = `${template.slug || slugify(template.name)}-copy-${Date.now()}`;

    try {
      await saveAdminTemplate({
        ...template,
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
    }
  }

  async function togglePublished(template: SharedTemplate) {
    try {
      const result = await publishAdminTemplate(template, !template.is_published);
      setTemplates((current) =>
        current.map((item) =>
          item.id === template.id ? (result.template as SharedTemplate) : item
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
    }
  }

  async function deleteTemplate(template: SharedTemplate) {
    const confirmed = window.confirm(
      `Delete template "${template.name}"? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
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
    }
  }

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />

      <section className="flex-1 space-y-8 px-10 py-10">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-white/40">
              Management
            </p>
            <h1 className="mt-2 text-4xl font-semibold">Current Templates</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/55">
              Search, edit, duplicate, publish and delete templates from the
              Admin-managed catalogue.
            </p>
          </div>
        </div>

        {templateError && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {templateError}
          </div>
        )}

        {templateMessage && (
          <div className="rounded-2xl border border-green-400/30 bg-green-500/10 px-4 py-3 text-sm text-green-100">
            {templateMessage}
          </div>
        )}

        <div className="rounded-3xl border border-white/10 bg-white/5">
          <div className="flex flex-col gap-4 border-b border-white/10 p-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold">Templates</h2>
              <span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-medium text-purple-100">
                {templates.length} total
              </span>
            </div>

            <div className="w-full md:max-w-sm">
              <label htmlFor="template-search" className="sr-only">
                Search templates by name
              </label>
              <input
                id="template-search"
                value={templateSearch}
                onChange={(event) => setTemplateSearch(event.target.value)}
                placeholder="Search templates..."
                className="inputStyle"
              />
            </div>
          </div>

          <div className="max-h-[760px] overflow-y-auto p-6">
            <div className="flex flex-wrap justify-center gap-6">
              {filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className="w-[260px] shrink-0 rounded-2xl border border-white/10 bg-white/5 p-3 transition hover:border-[#AC00FF]/35 hover:bg-white/[0.07]"
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
                    </div>

                    <AccessBadge level={template.access_level || "free"} />
                  </div>

                  <div className="mt-3 border-t border-white/10 pt-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs ${
                        template.is_published
                          ? "bg-green-500/20 text-green-300"
                          : "bg-white/10 text-white/50"
                      }`}
                    >
                      {template.is_published ? "Published" : "Draft"}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => editTemplate(template)}
                      className="rounded-lg bg-white/10 py-2 text-xs hover:bg-white/15"
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => duplicateTemplate(template)}
                      className="rounded-lg bg-white/10 py-2 text-xs hover:bg-white/15"
                    >
                      Duplicate
                    </button>

                    <button
                      type="button"
                      onClick={() => togglePublished(template)}
                      className="rounded-lg bg-[#AC00FF] py-2 text-xs hover:opacity-90"
                    >
                      {template.is_published ? "Unpublish" : "Publish"}
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteTemplate(template)}
                      className="rounded-lg bg-white/10 py-2 text-xs hover:bg-red-500/20"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
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
  const displayLevel = level === "free" ? "Free" : "Paid";
  const styles =
    displayLevel === "Free"
      ? "bg-white/10 text-white/55"
      : "bg-yellow-500/20 text-yellow-300";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {displayLevel}
    </span>
  );
}
