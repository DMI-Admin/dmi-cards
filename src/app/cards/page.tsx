"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import CardRenderer from "@/components/CardRenderer";
import { supabase } from "@/lib/supabase";

type Client = {
  id: string;
  full_name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  account_type: string | null;
  subscription_plan: string | null;
  billing_status: string | null;
};

type Template = {
  id: string;
  name: string;
  layout_type: string | null;
  logo_size?: string | null;
  access_level: string | null;
  requires_profile_image?: boolean | null;
  requires_logo?: boolean | null;
  supports_bio?: boolean | null;
  supports_save_contact?: boolean | null;
  allowed_fields: string[] | null;
  is_published: boolean;
};

type Card = {
  id: string;
  client_id: string | null;
  template_id: string | null;
  card_name: string | null;
  name?: string | null;
  full_name: string | null;
  status: string | null;
  is_published: boolean | null;
  job_title?: string | null;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  whatsapp?: string | null;
  linkedin?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  youtube?: string | null;
  booking_link?: string | null;
  custom_url?: string | null;
  created_at?: string;
};

type StaffUser = {
  id: string;
  client_id: string | null;
  company_name?: string | null;
  full_name: string | null;
  name?: string | null;
  email: string | null;
  phone?: string | null;
  job_title?: string | null;
  website?: string | null;
  address?: string | null;
  whatsapp?: string | null;
  linkedin?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  youtube?: string | null;
  booking_link?: string | null;
  custom_url?: string | null;
  status?: string | null;
};

export default function CardsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [selectedPreparedUser, setSelectedPreparedUser] =
    useState<StaffUser | null>(null);
  const [editingPreparedUser, setEditingPreparedUser] =
    useState<StaffUser | null>(null);
  const [previewPreparedUser, setPreviewPreparedUser] =
    useState<StaffUser | null>(null);
  const [previewActiveCard, setPreviewActiveCard] = useState<Card | null>(null);
  const [selectedPreparedUserIds, setSelectedPreparedUserIds] = useState<
    string[]
  >([]);

  const [clientId, setClientId] = useState("");
  const [templateId, setTemplateId] = useState("");

  const selectedClient = clients.find((client) => client.id === clientId);
  const selectedTemplate = templates.find(
    (template) => template.id === templateId
  );
  const businessClients = useMemo(() => {
    return clients.filter(
      (client) =>
        client.account_type === "business" || client.account_type === "enterprise"
    );
  }, [clients]);
  const selectedPreparedUsers = useMemo(() => {
    const selectedIds = new Set(selectedPreparedUserIds);
    return staffUsers.filter((user) => selectedIds.has(user.id));
  }, [staffUsers, selectedPreparedUserIds]);
  const allPreparedSelected =
    staffUsers.length > 0 && selectedPreparedUserIds.length === staffUsers.length;

  const activeCards = useMemo(() => {
    return cards
      .filter((card) => card.client_id === clientId)
      .map((card) => {
        const template = templates.find((item) => item.id === card.template_id);

        return {
          ...card,
          templateName: template?.name || "Unknown template",
        };
      });
  }, [cards, clientId, templates]);

  useEffect(() => {
    let ignore = false;

    async function loadAdminData() {
      setLoading(true);

      const [clientsResult, templatesResult] = await Promise.all([
        supabase
          .from("clients")
          .select("*")
          .order("full_name", { ascending: true }),
        supabase
          .from("templates")
          .select("*")
          .eq("is_published", true)
          .order("name", { ascending: true }),
      ]);

      if (ignore) return;

      if (clientsResult.error) alert(clientsResult.error.message);
      if (templatesResult.error) alert(templatesResult.error.message);
      if (clientsResult.data) setClients(clientsResult.data);
      if (templatesResult.data) setTemplates(templatesResult.data);
      setCards([]);

      setLoading(false);
    }

    void loadAdminData();

    return () => {
      ignore = true;
    };
  }, []);

  async function fetchCards(companyId = clientId) {
    if (!companyId) {
      setCards([]);
      return;
    }

    const { data, error } = await supabase
      .from("cards")
      .select("*")
      .eq("client_id", companyId)
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    if (data) setCards(data);
  }

  async function fetchCompanyUsers(companyId = clientId) {
    if (!companyId) {
      setStaffUsers([]);
      setSelectedPreparedUserIds([]);
      return;
    }

    const { data, error } = await supabase
      .from("client_users")
      .select("*")
      .eq("client_id", companyId);

    if (error) {
      console.info("No linked client_users data available for card preparation.");
      setStaffUsers([]);
      setSelectedPreparedUserIds([]);
      return;
    }

    if (data) {
      setStaffUsers(data);
      setSelectedPreparedUserIds(data.map((user) => user.id));
    }
  }

  function selectClient(value: string) {
    setClientId(value);
    setReviewReady(false);
    setStaffUsers([]);
    setSelectedPreparedUserIds([]);
    setPreviewActiveCard(null);
    void fetchCards(value);
  }

  function selectTemplate(value: string) {
    setTemplateId(value);
    setReviewReady(false);
    setStaffUsers([]);
    setSelectedPreparedUserIds([]);
  }

  async function prepareDigitalCards() {
    if (!clientId || !templateId) return;

    setPreparing(true);
    await Promise.all([fetchCompanyUsers(clientId), fetchCards(clientId)]);
    setReviewReady(true);
    setPreparing(false);
  }

  async function publishCardsForCompany() {
    if (!selectedClient || !selectedTemplate || selectedPreparedUsers.length === 0) {
      return;
    }

    setPublishing(true);

    const timestamp = Date.now();
    const companyName =
      selectedClient.company_name || selectedClient.full_name || "company";
    const showDmiBranding = selectedTemplate.access_level === "free";
    const cardRows = selectedPreparedUsers.map((user, index) => {
      const fullName = user.full_name || user.name || "Unnamed User";

      return {
        client_id: selectedClient.id,
        template_id: selectedTemplate.id,
        card_name: `${fullName} Digital Card`,
        slug: `${slugify(companyName)}-${slugify(fullName)}-${timestamp}-${index + 1}`,
        full_name: fullName,
        job_title: user.job_title || "",
        company_name: companyName,
        email: user.email || "",
        phone: user.phone || "",
        website: user.website || "",
        address: user.address || "",
        whatsapp: user.whatsapp || "",
        linkedin: user.linkedin || "",
        instagram: user.instagram || "",
        facebook: user.facebook || "",
        youtube: user.youtube || "",
        booking_link: user.booking_link || "",
        custom_url: user.custom_url || "",
        show_dmi_branding: showDmiBranding,
        status: "active",
        is_published: true,
      };
    });

    const { error } = await supabase.from("cards").insert(cardRows);

    setPublishing(false);

    if (error) {
      alert(error.message);
      return;
    }

    alert(`Published ${cardRows.length} cards for ${companyName}.`);
    await Promise.all([
      fetchCards(selectedClient.id),
      fetchCompanyUsers(selectedClient.id),
    ]);
  }

  function savePreparedUserEdits(updatedUser: StaffUser) {
    setStaffUsers((current) =>
      current.map((user) => (user.id === updatedUser.id ? updatedUser : user))
    );
    setEditingPreparedUser(null);
  }

  function togglePreparedUserSelection(userId: string) {
    setSelectedPreparedUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    );
  }

  function toggleAllPreparedUsers() {
    setSelectedPreparedUserIds(
      allPreparedSelected ? [] : staffUsers.map((user) => user.id)
    );
  }

  async function togglePublished(card: Card) {
    const nextPublished = !card.is_published;

    const { error } = await supabase
      .from("cards")
      .update({
        is_published: nextPublished,
        status: nextPublished ? "published" : "draft",
      })
      .eq("id", card.id);

    if (error) {
      alert(error.message);
      return;
    }

    await fetchCards(card.client_id || clientId);
  }

  async function deleteCard(card: Card) {
    const confirmed = window.confirm(
      "Delete this card permanently? This may affect the client’s card limit and public card URL."
    );

    if (!confirmed) return;

    const { error } = await supabase.from("cards").delete().eq("id", card.id);

    if (error) {
      alert(error.message);
      return;
    }

    await fetchCards(card.client_id || clientId);
  }

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <div className="mb-8">
          <h1 className="text-4xl font-bold">Digital Cards</h1>
          <p className="mt-2 text-white/50">
            Prepare and manage business or enterprise staff cards from imported
            client users.
          </p>
        </div>

        <div className="mb-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <StepLabel label="Step 1" />
              <h2 className="mt-2 text-2xl font-semibold">Select Company</h2>
              <p className="mt-1 text-sm text-white/45">
                Choose the business or enterprise client before preparing cards.
              </p>
            </div>

            <span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-medium text-purple-100">
              {businessClients.length} companies
            </span>
          </div>

          <div className="mt-6 grid grid-cols-[minmax(280px,420px)_1fr] gap-4">
            <Field label="Company / Client">
              <select
                value={clientId}
                onChange={(event) => selectClient(event.target.value)}
                className="inputStyle"
              >
                <option value="">Select company</option>
                {businessClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.company_name || "Unnamed company"}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-4 gap-3 rounded-2xl border border-white/10 bg-[#101935]/60 p-4">
              <DetailPill
                label="Company"
                value={
                  selectedClient?.company_name ||
                  selectedClient?.full_name ||
                  "Not selected"
                }
              />
              <DetailPill
                label="Account"
                value={selectedClient?.account_type || "Not selected"}
              />
              <DetailPill
                label="Plan"
                value={selectedClient?.subscription_plan || "Not selected"}
              />
              <DetailPill
                label="Billing"
                value={selectedClient?.billing_status || "Not selected"}
              />
            </div>
          </div>
        </div>

        <div className="mb-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <StepLabel label="Step 2" />
              <h2 className="mt-2 text-2xl font-semibold">Select Template</h2>
              <p className="mt-1 text-sm text-white/45">
                Choose one published template to apply to this company batch.
              </p>
            </div>

            <span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-medium text-purple-100">
              {templates.length} published
            </span>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-6">
            {templates.map((template) => {
              const selected = template.id === templateId;

              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => selectTemplate(template.id)}
                  className={`w-[260px] shrink-0 rounded-2xl border p-3 text-left transition ${
                    selected
                      ? "border-[#AC00FF] bg-[#AC00FF]/15 shadow-[0_0_0_4px_rgba(172,0,255,0.12)]"
                      : "border-white/10 bg-white/5 hover:border-[#AC00FF]/35 hover:bg-white/[0.07]"
                  }`}
                >
                  <div className="mb-3 flex h-36 items-start justify-center overflow-hidden rounded-xl bg-[#070B1A]/60">
                    <div className="mx-auto origin-top scale-[0.28]">
                      <div className="mx-auto w-[560px]">
                        <CardRenderer
                          mode="compact"
                          template={template}
                          cardData={{
                            full_name: template.name,
                            job_title: `${template.layout_type || "classic"} layout`,
                            company_name: "DMI Cards",
                            email: "hello@devmasterinc.com",
                            phone: "+44 7000 000000",
                            website: "devmasterinc.com",
                            address: "London, United Kingdom",
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold">
                        {template.name}
                      </h3>
                    </div>

                    <AccessBadge level={template.access_level || "free"} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <StepLabel label="Step 3" />
              <h2 className="mt-2 text-2xl font-semibold">
                Prepare Digital Cards
              </h2>
              <p className="mt-1 text-sm text-white/45">
                Review imported users before creating final cards. Nothing is
                created until the final review step.
              </p>
            </div>

            <button
              onClick={prepareDigitalCards}
              disabled={!clientId || !templateId || preparing}
              className="rounded-2xl bg-[#AC00FF] px-6 py-3 text-sm font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {preparing ? "Preparing..." : "Prepare Digital Cards"}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <DetailPill
              label="Selected company"
              value={
                selectedClient?.company_name ||
                selectedClient?.full_name ||
                "Not selected"
              }
            />
            <DetailPill
              label="Selected template"
              value={selectedTemplate?.name || "Not selected"}
            />
          </div>
        </div>

        {reviewReady && (
          <div className="mb-8 rounded-3xl border border-white/10 bg-white/5">
            <div className="flex items-center justify-between border-b border-white/10 p-6">
              <div>
                <StepLabel label="Step 4" />
                <h2 className="mt-2 text-2xl font-semibold">
                  Review Prepared Cards
                </h2>
                <p className="mt-1 text-sm text-white/45">
                  Confirm the prepared staff card records before publishing.
                </p>
              </div>

              <span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-medium text-purple-100">
                {selectedPreparedUserIds.length} selected
              </span>
            </div>

            <div className="p-6">
              {staffUsers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/15 bg-[#101935]/50 p-8 text-center">
                  <h3 className="text-lg font-semibold">
                    No users found for this company.
                  </h3>
                  <p className="mt-2 text-sm text-white/45">
                    Add users in Client Onboarding first.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <div className="border-b border-white/10 bg-[#101935] px-4 py-3">
                    <h3 className="font-semibold">Prepared Cards</h3>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-white/5 text-xs uppercase tracking-[0.14em] text-white/40">
                      <tr>
                        <th className="w-12 px-4 py-3 font-medium">
                          <PremiumCheckbox
                            checked={allPreparedSelected}
                            onChange={toggleAllPreparedUsers}
                            label="Select all prepared cards"
                          />
                        </th>
                        <th className="px-4 py-3 font-medium">Full Name</th>
                        <th className="px-4 py-3 font-medium">Job Title</th>
                        <th className="px-4 py-3 font-medium">Email</th>
                        <th className="px-4 py-3 font-medium">Phone</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {staffUsers.map((user) => (
                        <tr key={user.id}>
                          <td className="px-4 py-3">
                            <PremiumCheckbox
                              checked={selectedPreparedUserIds.includes(user.id)}
                              onChange={() => togglePreparedUserSelection(user.id)}
                              label={`Select ${user.full_name || user.name || "user"}`}
                            />
                          </td>
                          <td className="px-4 py-3">
                            {user.full_name || user.name || "Unnamed user"}
                          </td>
                          <td className="px-4 py-3 text-white/55">
                            {user.job_title || "Not set"}
                          </td>
                          <td className="px-4 py-3 text-white/55">
                            {user.email || "No email"}
                          </td>
                          <td className="px-4 py-3 text-white/55">
                            {user.phone || "No phone"}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={user.status || "ready"} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={() => setSelectedPreparedUser(user)}
                                className="text-sm text-blue-300 hover:text-blue-200"
                              >
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingPreparedUser(user)}
                                className="text-sm text-purple-300 hover:text-purple-200"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setPreviewPreparedUser(user)}
                                className="text-sm text-green-300 hover:text-green-200"
                              >
                                Card Preview
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {reviewReady && (
          <div className="mb-8 rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <StepLabel label="Step 5" />
                <h2 className="mt-2 text-2xl font-semibold">Publish Cards</h2>
                <p className="mt-1 text-sm text-white/45">
                  Create and publish one digital card for every prepared user.
                </p>
              </div>

                <button
                onClick={publishCardsForCompany}
                disabled={selectedPreparedUsers.length === 0 || publishing}
                className="rounded-2xl bg-[#AC00FF] px-6 py-3 text-sm font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {publishing ? "Publishing..." : "Publish Cards For Company"}
              </button>
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-white/10 bg-white/5">
          <div className="flex items-center justify-between border-b border-white/10 p-6">
            <div>
              <h2 className="text-2xl font-semibold">
                Active Cards For Selected Company
              </h2>
              <p className="mt-1 text-sm text-white/45">
                Manage cards already created for this company.
              </p>
              <p className="mt-2 text-xs text-white/35">
                Admin deletion is for support and enterprise management only.
              </p>
            </div>

            <span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-medium text-purple-100">
              {activeCards.length} active
            </span>
          </div>

          <div className="max-h-[760px] overflow-y-auto p-6">
            {!clientId ? (
              <div className="rounded-2xl border border-dashed border-white/15 bg-[#101935]/50 p-8 text-center">
                <h3 className="text-lg font-semibold">Select a company</h3>
                <p className="mt-2 text-sm text-white/45">
                  Active cards will appear here after you choose a company.
                </p>
              </div>
            ) : loading ? (
              <p className="text-sm text-white/45">Loading cards...</p>
            ) : activeCards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 bg-[#101935]/50 p-8 text-center">
                <h3 className="text-lg font-semibold">
                  No active cards found for this company.
                </h3>
                <p className="mt-2 text-sm text-white/45">
                  Prepare users above before creating final cards.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#101935] text-xs uppercase tracking-[0.14em] text-white/40">
                    <tr>
                      <th className="px-4 py-3 font-medium">Card Name</th>
                      <th className="px-4 py-3 font-medium">Full Name</th>
                      <th className="px-4 py-3 font-medium">Template</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Published</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {activeCards.map((card) => (
                      <tr key={card.id} className="hover:bg-white/5">
                        <td className="px-4 py-3 font-medium">
                          {card.card_name || card.name || "Untitled card"}
                        </td>
                        <td className="px-4 py-3 text-white/60">
                          {card.full_name || "No full name"}
                        </td>
                        <td className="px-4 py-3 text-white/60">
                          {card.templateName}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={card.status || "draft"} />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs ${
                              card.is_published
                                ? "bg-green-500/20 text-green-300"
                                : "bg-white/10 text-white/50"
                            }`}
                          >
                            {card.is_published ? "Published" : "Draft"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-3">
                            <button
                              onClick={() => setPreviewActiveCard(card)}
                              className="text-sm text-green-300 hover:text-green-200"
                            >
                              Preview
                            </button>
                            <button
                              onClick={() => togglePublished(card)}
                              className="text-sm text-blue-300 hover:text-blue-200"
                            >
                              {card.is_published ? "Unpublish" : "Publish"}
                            </button>

                            <button
                              onClick={() => deleteCard(card)}
                              className="text-sm text-red-300 hover:text-red-200"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {selectedPreparedUser && (
        <PreparedUserModal
          user={selectedPreparedUser}
          companyName={
            selectedClient?.company_name || selectedClient?.full_name || "-"
          }
          templateName={selectedTemplate?.name || "-"}
          onClose={() => setSelectedPreparedUser(null)}
        />
      )}

      {editingPreparedUser && (
        <EditPreparedUserModal
          user={editingPreparedUser}
          onClose={() => setEditingPreparedUser(null)}
          onSave={savePreparedUserEdits}
        />
      )}

      {previewPreparedUser && selectedTemplate && (
        <CardPreviewModal
          cardData={{
            ...previewPreparedUser,
            full_name:
              previewPreparedUser.full_name ||
              previewPreparedUser.name ||
              "Unnamed User",
            company_name:
              selectedClient?.company_name || selectedClient?.full_name || "-",
          }}
          template={selectedTemplate}
          onClose={() => setPreviewPreparedUser(null)}
        />
      )}

      {previewActiveCard && (
        <CardPreviewModal
          cardData={previewActiveCard}
          template={
            templates.find((template) => template.id === previewActiveCard.template_id) ||
            fallbackTemplate
          }
          onClose={() => setPreviewActiveCard(null)}
        />
      )}
    </main>
  );
}

function StepLabel({ label }: { label: string }) {
  return (
    <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#AC00FF]">
      {label}
    </p>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-white/55">
        {label}
      </span>
      {children}
    </label>
  );
}

function DetailPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2">
      <p className="text-xs text-white/35">{label}</p>
      <p className="mt-1 truncate text-sm capitalize text-white/80">{value}</p>
    </div>
  );
}

function PremiumCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={onChange}
      className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
        checked
          ? "border-[#AC00FF] bg-[#AC00FF] shadow-[0_0_16px_rgba(172,0,255,0.35)]"
          : "border-white/20 bg-white/5 hover:border-[#AC00FF]/60"
      }`}
    >
      {checked && <span className="h-2 w-2 rounded-sm bg-white" />}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "active" || status === "ready"
      ? "bg-green-500/20 text-green-300"
      : status === "published"
      ? "bg-blue-500/20 text-blue-300"
      : status === "draft"
      ? "bg-white/10 text-white/50"
      : "bg-yellow-500/20 text-yellow-300";

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs capitalize ${styles}`}>
      {status}
    </span>
  );
}

function AccessBadge({ level }: { level: string }) {
  const styles =
    level === "free"
      ? "bg-white/10 text-white/55"
      : level === "premium"
      ? "bg-yellow-500/20 text-yellow-300"
      : "bg-blue-500/20 text-blue-300";

  return (
    <span className={`rounded-full px-3 py-1 text-xs capitalize ${styles}`}>
      {level}
    </span>
  );
}

function PreparedUserModal({
  user,
  companyName,
  templateName,
  onClose,
}: {
  user: StaffUser;
  companyName: string;
  templateName: string;
  onClose: () => void;
}) {
  const details = [
    ["Company", companyName],
    ["Template", templateName],
    ["Full Name", user.full_name || user.name || "-"],
    ["Job Title", user.job_title || "-"],
    ["Email", user.email || "-"],
    ["Phone", user.phone || "-"],
    ["Website", user.website || "-"],
    ["Address", user.address || "-"],
    ["WhatsApp", user.whatsapp || "-"],
    ["LinkedIn", user.linkedin || "-"],
    ["Instagram", user.instagram || "-"],
    ["Facebook", user.facebook || "-"],
    ["YouTube", user.youtube || "-"],
    ["Booking Link", user.booking_link || "-"],
    ["Custom URL", user.custom_url || "-"],
    ["Status", user.status || "ready"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-[#0F0E38] text-white shadow-2xl shadow-[#AC00FF]/20">
        <div className="flex items-start justify-between gap-6 border-b border-white/10 bg-[#0F0E38] p-6">
          <div>
            <h2 className="text-2xl font-semibold">Prepared Card Details</h2>
            <p className="mt-1 text-sm text-white/45">
              Review the user details that will be published into a digital card.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-medium transition hover:bg-white/15"
          >
            Close
          </button>
        </div>

        <div className="max-h-[calc(85vh-104px)] overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            {details.map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <p className="text-xs uppercase tracking-[0.14em] text-white/35">
                  {label}
                </p>
                <p className="mt-3 break-words text-sm text-white/80">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditPreparedUserModal({
  user,
  onClose,
  onSave,
}: {
  user: StaffUser;
  onClose: () => void;
  onSave: (user: StaffUser) => void;
}) {
  const [form, setForm] = useState({
    full_name: user.full_name || user.name || "",
    job_title: user.job_title || "",
    email: user.email || "",
    phone: user.phone || "",
    website: user.website || "",
    address: user.address || "",
    whatsapp: user.whatsapp || "",
    linkedin: user.linkedin || "",
    instagram: user.instagram || "",
    facebook: user.facebook || "",
    youtube: user.youtube || "",
    booking_link: user.booking_link || "",
    custom_url: user.custom_url || "",
  });
  const fields = [
    ["full_name", "Full Name"],
    ["job_title", "Job Title"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["website", "Website"],
    ["address", "Address"],
    ["whatsapp", "WhatsApp"],
    ["linkedin", "LinkedIn"],
    ["instagram", "Instagram"],
    ["facebook", "Facebook"],
    ["youtube", "YouTube"],
    ["booking_link", "Booking Link"],
    ["custom_url", "Custom URL"],
  ];

  function updateField(field: string, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function saveEdits() {
    if (!form.full_name.trim()) {
      alert("Full name is required.");
      return;
    }

    onSave({
      ...user,
      full_name: form.full_name,
      name: form.full_name,
      job_title: form.job_title,
      email: form.email,
      phone: form.phone,
      website: form.website,
      address: form.address,
      whatsapp: form.whatsapp,
      linkedin: form.linkedin,
      instagram: form.instagram,
      facebook: form.facebook,
      youtube: form.youtube,
      booking_link: form.booking_link,
      custom_url: form.custom_url,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0F0E38] text-white shadow-2xl shadow-[#AC00FF]/20">
        <div className="flex items-start justify-between gap-6 border-b border-white/10 bg-[#0F0E38] p-6">
          <div>
            <h2 className="text-2xl font-semibold">Edit Prepared Card</h2>
            <p className="mt-1 text-sm text-white/45">
              Make final local edits before publishing. Client Onboarding data is
              not changed.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-medium transition hover:bg-white/15"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-3">
            {fields.map(([field, label]) => (
              <label
                key={field}
                className="rounded-2xl border border-white/10 bg-white/5 p-3"
              >
                <span className="text-xs uppercase tracking-[0.14em] text-white/35">
                  {label}
                </span>
                <input
                  value={form[field as keyof typeof form]}
                  onChange={(event) => updateField(field, event.target.value)}
                  className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-[#101935] px-3 text-sm outline-none transition focus:border-[#AC00FF]"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-white/10 bg-[#0F0E38] p-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-medium transition hover:bg-white/15"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveEdits}
            className="rounded-2xl bg-[#AC00FF] px-5 py-3 text-sm font-medium transition hover:opacity-90"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

const fallbackTemplate: Template = {
  id: "fallback",
  name: "Digital Card",
  layout_type: "classic",
  logo_size: "standard",
  access_level: "premium",
  allowed_fields: ["phone", "email", "website", "address"],
  is_published: true,
};

function CardPreviewModal({
  cardData,
  template,
  onClose,
}: {
  cardData: Card | StaffUser;
  template: Template;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-[#0F0E38] text-white shadow-2xl shadow-[#AC00FF]/20">
        <div className="flex items-start justify-between gap-6 border-b border-white/10 bg-[#0F0E38] p-6">
          <div>
            <h2 className="text-2xl font-semibold">Card Preview</h2>
            <p className="mt-1 text-sm text-white/45">
              {template.name} · {template.layout_type || "classic"} layout
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-medium transition hover:bg-white/15"
          >
            Close
          </button>
        </div>

        <div className="max-h-[calc(85vh-104px)] overflow-y-auto p-6">
          <div className="mx-auto max-w-md">
            <CardRenderer
              mode="preview"
              showActions={template.supports_save_contact ?? true}
              template={template}
              cardData={cardData}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
