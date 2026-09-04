"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  Archive,
  BriefcaseBusiness,
  CalendarDays,
  ContactRound,
  Download,
  Eye,
  FileDown,
  IdCard,
  Lock,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  UsersRound,
  X,
} from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";
import PhoneInput from "@/components/PhoneInput";
import UpgradeToProButton from "@/components/UpgradeToProButton";
import { normalizeInternationalPhoneNumber } from "@/lib/phone-number";
import { supabase } from "@/lib/supabase";
import { useClientPlan } from "@/lib/use-client-plan";

type ContactSource =
  | "digital_card"
  | "business_card_scan"
  | "manual"
  | "import"
  | "integration";
type ContactStatus = "new" | "contacted" | "qualified" | "archived";
type ContactFilter = "all" | "card_1" | "card_2" | "card_3" | "business_card_scan" | "manual";

type PersistedContact = {
  id: string;
  card_id: string | null;
  card_slot: number | null;
  source: ContactSource;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  company: string | null;
  job_title: string | null;
  website: string | null;
  address: string | null;
  message: string | null;
  notes: string | null;
  tags: string[];
  status: ContactStatus;
  consent_given: boolean | null;
  consent_notice: string | null;
  terms_url: string | null;
  submitted_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type MarketingConsentStatus = "opted_in" | "not_opted_in" | "unknown";

type MarketingConsentDetails = {
  status: MarketingConsentStatus;
  enabled: boolean | null;
  optedIn: boolean | null;
  submittedAt: string | null;
  label: string | null;
  version: string | null;
  privacyNotice: string | null;
  privacyPolicyUrl: string | null;
};

type ContactFormState = {
  name: string;
  first_name: string;
  last_name: string;
  company: string;
  job_title: string;
  email: string;
  phone: string;
  mobile: string;
  website: string;
  address: string;
  status: ContactStatus;
  notes: string;
  tags: string;
};

const emptyForm: ContactFormState = {
  name: "",
  first_name: "",
  last_name: "",
  company: "",
  job_title: "",
  email: "",
  phone: "",
  mobile: "",
  website: "",
  address: "",
  status: "new",
  notes: "",
  tags: "",
};

const contactFilters: { value: ContactFilter; label: string }[] = [
  { value: "all", label: "All Contacts" },
  { value: "card_1", label: "Card 1" },
  { value: "card_2", label: "Card 2" },
  { value: "card_3", label: "Card 3" },
  { value: "business_card_scan", label: "Business Card Scan" },
  { value: "manual", label: "Manual" },
];

const statusOptions: { value: ContactStatus | "all"; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "archived", label: "Archived" },
];

export default function ClientContactsPage() {
  const { isPaid, loading: planLoading } = useClientPlan();
  const [contacts, setContacts] = useState<PersistedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [contactFilter, setContactFilter] = useState<ContactFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ContactStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedContact, setSelectedContact] = useState<PersistedContact | null>(null);
  const [editingContact, setEditingContact] = useState<PersistedContact | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [formState, setFormState] = useState<ContactFormState>(emptyForm);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  const queryString = useMemo(
    () =>
      buildContactsQuery({
        search,
        contactFilter,
        statusFilter,
        dateFrom,
        dateTo,
      }),
    [search, contactFilter, statusFilter, dateFrom, dateTo]
  );

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const accessToken = await requireAccessToken();
      const response = await fetch(`/api/client/contacts${queryString}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Could not load contacts."));
      }

      const payload = (await response.json()) as {
        data?: { contacts?: PersistedContact[] };
      };

      setContacts(payload.data?.contacts || []);
    } catch (error) {
      console.error("[DMI contacts] load failed", error);
      setLoadError(error instanceof Error ? error.message : "Could not load contacts.");
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    async function syncContacts() {
      if (planLoading) return;

      if (!isPaid) {
        setContacts([]);
        setLoading(false);
        return;
      }

      await loadContacts();
    }

    void syncContacts();
  }, [isPaid, loadContacts, planLoading]);

  const stats = {
    total: contacts.length,
    new: contacts.filter((contact) => contact.status === "new").length,
    contacted: contacts.filter((contact) => contact.status === "contacted").length,
    qualified: contacts.filter((contact) => contact.status === "qualified").length,
    archived: contacts.filter((contact) => contact.status === "archived").length,
    manual: contacts.filter((contact) => contact.source === "manual").length,
  };

  function openAddModal() {
    setFormState(emptyForm);
    setEditingContact(null);
    setActionError("");
    setAddModalOpen(true);
  }

  function openEditModal(contact: PersistedContact) {
    setFormState({
      name: contact.name || "",
      first_name: contact.first_name || "",
      last_name: contact.last_name || "",
      company: contact.company || "",
      job_title: contact.job_title || "",
      email: contact.email || "",
      phone: contact.phone || "",
      mobile: contact.mobile || "",
      website: contact.website || "",
      address: contact.address || "",
      status: contact.status,
      notes: contact.notes || "",
      tags: contact.tags.join(", "),
    });
    setEditingContact(contact);
    setActionError("");
    setAddModalOpen(true);
  }

  async function saveManualContact() {
    if (saving) return;

    if (!hasAnyIdentityField(formState)) {
      setActionError("Add a name, email, phone, mobile, or company before saving.");
      return;
    }

    setSaving(true);
    setActionError("");
    setMessage("");

    try {
      const accessToken = await requireAccessToken();
      const body = contactPayloadFromForm(formState);
      const url = editingContact
        ? `/api/client/contacts/${encodeURIComponent(editingContact.id)}`
        : "/api/client/contacts";
      const response = await fetch(url, {
        method: editingContact ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Could not save contact."));
      }

      setAddModalOpen(false);
      setMessage(editingContact ? "Contact updated." : "Contact added.");
      await loadContacts();
    } catch (error) {
      console.error("[DMI contacts] save failed", error);
      setActionError(error instanceof Error ? error.message : "Could not save contact.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadCsv() {
    setActionError("");
    setMessage("");

    try {
      const accessToken = await requireAccessToken();
      const response = await fetch(`/api/client/contacts/export.csv${queryString}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Could not export contacts."));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "dmi-card-contacts.csv";
      link.click();
      URL.revokeObjectURL(url);
      setMessage("CSV downloaded.");
    } catch (error) {
      console.error("[DMI contacts] export failed", error);
      setActionError(error instanceof Error ? error.message : "Could not export contacts.");
    }
  }

  async function deleteContact(contact: PersistedContact) {
    if (!window.confirm(`Delete ${displayContactName(contact)}?`)) return;

    setActionError("");
    setMessage("");

    try {
      const accessToken = await requireAccessToken();
      const response = await fetch(
        `/api/client/contacts/${encodeURIComponent(contact.id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Could not delete contact."));
      }

      setSelectedContact((current) => (current?.id === contact.id ? null : current));
      setContacts((current) => current.filter((item) => item.id !== contact.id));
      setMessage("Contact deleted.");
    } catch (error) {
      console.error("[DMI contacts] delete failed", error);
      setActionError(error instanceof Error ? error.message : "Could not delete contact.");
    }
  }

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <ClientSidebar />

      <section className="flex-1 p-10">
        <div className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#AC00FF]">
              Client Portal
            </p>
            <h1 className="mt-3 text-4xl font-bold">Contacts</h1>
            <p className="mt-3 max-w-3xl text-white/50">
              Manage every contact saved to your DMI Cards address book.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20 transition hover:shadow-purple-500/35"
            >
              <Plus className="h-4 w-4" />
              Add Contact Manually
            </button>
            <ActionButton icon={Download} onClick={downloadCsv}>
              Download CSV
            </ActionButton>
          </div>
        </div>

        {message && (
          <div className="mb-6 rounded-2xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 px-5 py-4 text-sm text-purple-100">
            {message}
          </div>
        )}

        {actionError && (
          <div className="mb-6 rounded-2xl border border-red-300/25 bg-red-500/10 px-5 py-4 text-sm text-red-100">
            {actionError}
          </div>
        )}

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="Total Contacts" value={String(stats.total)} icon={UsersRound} />
          <SummaryCard label="New" value={String(stats.new)} icon={ContactRound} />
          <SummaryCard label="Contacted" value={String(stats.contacted)} icon={UserCheck} />
          <SummaryCard label="Qualified" value={String(stats.qualified)} icon={BriefcaseBusiness} />
          <SummaryCard label="Archived" value={String(stats.archived)} icon={Archive} />
          <SummaryCard label="Manual Entries" value={String(stats.manual)} icon={FileDown} />
        </div>

        <section className="relative rounded-3xl border border-white/10 bg-[#101935]/70 shadow-2xl shadow-black/20">
          {!isPaid && !planLoading && <LockedOverlay />}

          <div className={!isPaid && !planLoading ? "pointer-events-none blur-[2px]" : ""}>
            <div className="border-b border-white/10 p-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold">Lead Inbox</h2>
                  <p className="mt-2 text-sm text-white/45">
                    Search, filter, and action contacts from every source.
                  </p>
                </div>
                <div className="rounded-full border border-[#AC00FF]/25 bg-[#AC00FF]/10 px-3 py-1 text-xs font-semibold text-purple-100">
                  {contacts.length} visible
                </div>
              </div>

              <div className="mt-6 grid gap-3 xl:grid-cols-[minmax(280px,1fr)_190px_170px_150px_150px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search first name, last name, company, email, or phone"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#AC00FF]/60"
                  />
                </div>
                <FilterSelect
                  value={contactFilter}
                  onChange={(value) => setContactFilter(value as ContactFilter)}
                  options={contactFilters}
                />
                <FilterSelect
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value as ContactStatus | "all")}
                  options={statusOptions}
                />
                <DateInput label="From" value={dateFrom} onChange={setDateFrom} />
                <DateInput label="To" value={dateTo} onChange={setDateTo} />
              </div>
            </div>

            <div className="max-h-[620px] max-w-full overflow-auto">
              <table className="w-full min-w-[1260px] text-sm">
                <thead className="sticky top-0 z-10 bg-[#070B1A] text-left text-white/45">
                  <tr className="border-b border-white/10">
                    <th className="p-4">First name</th>
                    <th className="p-4">Last name</th>
                    <th className="p-4">Company</th>
                    <th className="p-4">Email</th>
                    <th className="p-4">Phone</th>
                    <th className="p-4">Source</th>
                    <th className="p-4">Marketing</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Date</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading || planLoading ? (
                    <TableMessage colSpan={10} message="Loading contacts..." />
                  ) : loadError ? (
                    <TableMessage colSpan={10} message={loadError} tone="error" />
                  ) : contacts.length ? (
                    contacts.map((contact) => (
                      <tr key={contact.id} className="border-b border-white/5">
                        <td className="p-4">
                          <p className="font-semibold">{displayFirstName(contact)}</p>
                          <p className="mt-1 text-xs text-white/40">{contact.job_title || "No job title"}</p>
                        </td>
                        <td className="p-4 text-white/65">{displayLastName(contact)}</td>
                        <td className="p-4 text-white/65">{contact.company || "-"}</td>
                        <td className="p-4 text-white/65">{contact.email || "-"}</td>
                        <td className="p-4 text-white/65">{contact.phone || contact.mobile || "-"}</td>
                        <td className="p-4">
                          <SourceBadge contact={contact} />
                        </td>
                        <td className="p-4">
                          <MarketingBadge details={marketingConsentDetails(contact)} />
                        </td>
                        <td className="p-4">
                          <StatusBadge status={contact.status} />
                        </td>
                        <td className="p-4 text-white/55">{formatDate(contact.created_at)}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <IconAction label="View" icon={Eye} onClick={() => setSelectedContact(contact)} />
                            <IconAction label="Edit" icon={Pencil} onClick={() => openEditModal(contact)} />
                            <IconAction label="Delete" icon={Trash2} onClick={() => deleteContact(contact)} danger />
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <TableMessage colSpan={10} message="No contacts found." />
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <ContactFoundationPanel />

        {addModalOpen && (
          <ContactFormModal
            formState={formState}
            editing={Boolean(editingContact)}
            error={actionError}
            saving={saving}
            onChange={setFormState}
            onClose={() => setAddModalOpen(false)}
            onSave={saveManualContact}
          />
        )}

        {selectedContact && (
          <ContactDrawer
            contact={selectedContact}
            onClose={() => setSelectedContact(null)}
            onEdit={() => openEditModal(selectedContact)}
            onDelete={() => deleteContact(selectedContact)}
          />
        )}
      </section>
    </main>
  );
}

function LockedOverlay() {
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center rounded-3xl bg-[#070B1A]/55 p-4 pt-8 backdrop-blur-[1px] sm:items-center sm:p-6">
      <div className="w-full max-w-xl rounded-3xl border border-[#AC00FF]/30 bg-[#101935]/95 p-6 text-center shadow-2xl shadow-purple-950/40 sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-[#AC00FF]/20">
          <Lock className="h-7 w-7 text-purple-100" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold sm:text-3xl">Unlock Contacts</h2>
        <p className="mt-3 text-sm leading-6 text-white/60">
          Contacts is a paid address book for captured leads, manual contacts,
          exports, and future business-card scans.
        </p>
        <UpgradeToProButton
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-6 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20 sm:w-auto"
        >
          <Sparkles className="h-4 w-4" />
          Upgrade to Individual Pro
        </UpgradeToProButton>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="min-h-28 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-black/10">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
          {label}
        </p>
        <Icon className="h-4 w-4 text-purple-200" />
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#AC00FF]/60"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative block">
      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
      <input
        type="date"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-10 pr-3 text-sm text-white outline-none transition focus:border-[#AC00FF]/60"
      />
    </label>
  );
}

function SourceBadge({ contact }: { contact: PersistedContact }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/65">
      <span className="h-2 w-2 rounded-full bg-purple-200" />
      {contact.source === "digital_card" && contact.card_slot
        ? `Card ${contact.card_slot}`
        : sourceLabel(contact.source)}
    </span>
  );
}

function StatusBadge({ status }: { status: ContactStatus }) {
  const dot: Record<ContactStatus, string> = {
    new: "bg-blue-300",
    contacted: "bg-yellow-300",
    qualified: "bg-green-300",
    archived: "bg-white/35",
  };

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/65">
      <span className={`h-2 w-2 rounded-full ${dot[status]}`} />
      {statusLabel(status)}
    </span>
  );
}

function MarketingBadge({ details }: { details: MarketingConsentDetails }) {
  if (details.status === "unknown") {
    return <span className="text-white/35">—</span>;
  }

  const optedIn = details.status === "opted_in";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
        optedIn
          ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
          : "border-white/10 bg-white/5 text-white/55"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          optedIn ? "bg-emerald-300" : "bg-white/35"
        }`}
      />
      {optedIn ? "Opted in" : "Not opted in"}
    </span>
  );
}

function ActionButton({
  icon: Icon,
  children,
  onClick,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/75 transition hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:text-white"
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function IconAction({
  label,
  icon: Icon,
  onClick,
  danger = false,
}: {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={`flex h-11 w-11 items-center justify-center rounded-xl border transition ${
          danger
            ? "border-red-300/20 bg-red-500/10 text-red-200 hover:bg-red-500/15"
            : "border-white/10 bg-white/5 text-white/60 hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10 hover:text-white"
        }`}
      >
        <Icon className="h-4 w-4" />
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#070B1A] px-2 py-1 text-[11px] font-semibold text-white/75 opacity-0 shadow-lg shadow-black/30 transition group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}

function ContactFoundationPanel() {
  return (
    <section className="mt-6 rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-6 shadow-lg shadow-purple-950/15">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#AC00FF]/20">
          <IdCard className="h-6 w-6 text-purple-100" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Unified contacts database</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
            Contacts are owned by your account. Digital cards, manual entry,
            imports, and future business-card scans are sources, not separate
            contact books.
          </p>
        </div>
      </div>
    </section>
  );
}

function ContactFormModal({
  formState,
  editing,
  error,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  formState: ContactFormState;
  editing: boolean;
  error: string;
  saving: boolean;
  onChange: (form: ContactFormState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  function update(field: keyof ContactFormState, value: string) {
    onChange({ ...formState, [field]: value });
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close contact form"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] mx-auto max-h-[calc(100dvh-1.5rem)] max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-[#101935] p-5 shadow-2xl shadow-black/40 sm:inset-x-4 sm:top-8 sm:max-h-[calc(100dvh-4rem)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#AC00FF]">
              {editing ? "Edit Contact" : "Manual Contact Entry"}
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              {editing ? "Update contact" : "Add contact manually"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <TextField label="Full name" value={formState.name} onChange={(value) => update("name", value)} />
          <TextField label="Company" value={formState.company} onChange={(value) => update("company", value)} />
          <TextField label="First name" value={formState.first_name} onChange={(value) => update("first_name", value)} />
          <TextField label="Last name" value={formState.last_name} onChange={(value) => update("last_name", value)} />
          <TextField label="Job title" value={formState.job_title} onChange={(value) => update("job_title", value)} />
          <TextField label="Email" value={formState.email} onChange={(value) => update("email", value)} />
          <PhoneInput label="Phone" value={formState.phone} onChange={(value) => update("phone", value)} />
          <PhoneInput label="Mobile" value={formState.mobile} onChange={(value) => update("mobile", value)} />
          <TextField label="Website" value={formState.website} onChange={(value) => update("website", value)} />
          <TextField label="Address" value={formState.address} onChange={(value) => update("address", value)} />
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-white/55">Status</span>
            <select
              value={formState.status}
              onChange={(event) => update("status", event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#070B1A]/70 px-4 py-3 text-sm text-white outline-none transition focus:border-[#AC00FF]/60"
            >
              {statusOptions
                .filter((option) => option.value !== "all")
                .map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </select>
          </label>
          <TextField label="Source" value="Manual" onChange={() => undefined} disabled />
          <TextField label="Tags" value={formState.tags} onChange={(value) => update("tags", value)} />
        </div>

        <div className="mt-4">
          <TextArea label="Notes" value={formState.notes} onChange={(value) => update("notes", value)} />
        </div>

        <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap sm:justify-end">
          <ActionButton icon={X} onClick={onClose}>Cancel</ActionButton>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {saving ? "Saving..." : "Save Contact"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactDrawer({
  contact,
  onClose,
  onEdit,
  onDelete,
}: {
  contact: PersistedContact;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const marketingConsent = marketingConsentDetails(contact);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close contact details"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <aside className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#070B1A]/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 sm:p-6">
        <div className="rounded-3xl border border-white/10 bg-[#101935]/85 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#AC00FF]">
                Contact Details
              </p>
              <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">{displayContactName(contact)}</h2>
              <p className="mt-1 text-white/50">{contact.company || sourceLabel(contact.source)}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <ActionButton icon={Pencil} onClick={onEdit}>Edit</ActionButton>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-500/15"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <DetailItem label="First name" value={displayFirstName(contact)} />
            <DetailItem label="Last name" value={displayLastName(contact)} />
            {hasLegacyCombinedNameOnly(contact) && (
              <DetailItem label="Legacy name" value={contact.name || "-"} />
            )}
            <DetailItem label="Company" value={contact.company || "-"} />
            <DetailItem label="Job title" value={contact.job_title || "-"} />
            <DetailItem label="Email" value={contact.email || "-"} />
            <DetailItem label="Phone" value={contact.phone || "-"} />
            <DetailItem label="Mobile" value={contact.mobile || "-"} />
            <DetailItem label="Website" value={contact.website || "-"} />
            <DetailItem label="Address" value={contact.address || "-"} />
            <DetailItem label="Source" value={sourceDetail(contact)} />
            <DetailItem label="Status" value={statusLabel(contact.status)} />
            <DetailItem label="Created" value={formatDate(contact.created_at)} />
            <DetailItem label="Updated" value={formatDate(contact.updated_at)} />
          </div>

          <MarketingConsentPanel details={marketingConsent} />

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold text-white/55">Notes</p>
            <p className="mt-2 text-sm leading-6 text-white/75">{contact.notes || "No notes yet."}</p>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold text-white/55">Tags</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {contact.tags.length ? (
                contact.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/60">
                    {tag}
                  </span>
                ))
              ) : (
                <p className="text-sm text-white/45">No tags.</p>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function MarketingConsentPanel({
  details,
}: {
  details: MarketingConsentDetails;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white/55">
            Marketing consent
          </p>
          <p className="mt-1 text-xs text-white/35">
            Visitor marketing preference captured from the public card form.
          </p>
        </div>
        <MarketingBadge details={details} />
      </div>

      {details.status === "unknown" ? (
        <p className="mt-4 text-sm leading-6 text-white/50">
          No marketing consent record is available for this contact.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <DetailItem
            label="Status"
            value={details.status === "opted_in" ? "Opted in" : "Not opted in"}
          />
          <DetailItem
            label="Consent date"
            value={formatDateTime(details.submittedAt)}
          />
          <DetailItem
            label="Consent version"
            value={details.version || "-"}
          />
          <DetailItem
            label="Privacy policy"
            value={details.privacyPolicyUrl || "-"}
          />
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">
              Consent wording
            </p>
            <p className="mt-2 break-words text-sm font-semibold">
              {details.label || "-"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">
              Data-use notice
            </p>
            <p className="mt-2 break-words text-sm font-semibold">
              {details.privacyNotice || "-"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-white/55">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-[#070B1A]/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#AC00FF]/60 disabled:opacity-55"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-white/55">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className="w-full rounded-2xl border border-white/10 bg-[#070B1A]/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#AC00FF]/60"
      />
    </label>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-semibold">{value}</p>
    </div>
  );
}

function TableMessage({
  colSpan,
  message,
  tone = "default",
}: {
  colSpan: number;
  message: string;
  tone?: "default" | "error";
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-8 text-center">
        <span
          className={`inline-flex items-center gap-2 text-sm ${
            tone === "error" ? "text-red-100" : "text-white/50"
          }`}
        >
          {tone === "error" && <AlertCircle className="h-4 w-4" />}
          {message}
        </span>
      </td>
    </tr>
  );
}

async function requireAccessToken() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Please sign in again before managing contacts.");
  }

  return session.access_token;
}

async function apiErrorMessage(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
    };

    return payload.error?.message || fallback;
  } catch {
    return fallback;
  }
}

function buildContactsQuery({
  search,
  contactFilter,
  statusFilter,
  dateFrom,
  dateTo,
}: {
  search: string;
  contactFilter: ContactFilter;
  statusFilter: ContactStatus | "all";
  dateFrom: string;
  dateTo: string;
}) {
  const params = new URLSearchParams();
  const trimmedSearch = search.trim();

  if (trimmedSearch) params.set("search", trimmedSearch);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  if (contactFilter.startsWith("card_")) {
    params.set("source", "digital_card");
    params.set("cardSlot", contactFilter.replace("card_", ""));
  } else if (contactFilter !== "all") {
    params.set("source", contactFilter);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function contactPayloadFromForm(form: ContactFormState) {
  return {
    source: "manual",
    name: form.name,
    first_name: form.first_name,
    last_name: form.last_name,
    company: form.company,
    job_title: form.job_title,
    email: form.email,
    phone: normalizeInternationalPhoneNumber(form.phone) || form.phone,
    mobile: normalizeInternationalPhoneNumber(form.mobile) || form.mobile,
    website: form.website,
    address: form.address,
    status: form.status,
    notes: form.notes,
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    metadata: {},
  };
}

function hasAnyIdentityField(form: ContactFormState) {
  return Boolean(
    form.name.trim() ||
      form.first_name.trim() ||
      form.last_name.trim() ||
      form.email.trim() ||
      form.phone.trim() ||
      form.mobile.trim() ||
      form.company.trim()
  );
}

function displayContactName(contact: PersistedContact) {
  return (
    splitContactName(contact) ||
    contact.name ||
    contact.email ||
    contact.phone ||
    contact.mobile ||
    contact.company ||
    "Unnamed contact"
  );
}

function displayFirstName(contact: PersistedContact) {
  if (contact.first_name) return contact.first_name;
  if (hasLegacyCombinedNameOnly(contact)) return contact.name || "-";
  return "-";
}

function displayLastName(contact: PersistedContact) {
  return contact.last_name || "-";
}

function hasLegacyCombinedNameOnly(contact: PersistedContact) {
  return Boolean(contact.name && !contact.first_name && !contact.last_name);
}

function splitContactName(contact: PersistedContact) {
  return [contact.first_name, contact.last_name].filter(Boolean).join(" ");
}

function sourceLabel(source: ContactSource) {
  const labels: Record<ContactSource, string> = {
    digital_card: "Digital Card",
    business_card_scan: "Business Card Scan",
    manual: "Manual",
    import: "Import",
    integration: "Integration",
  };

  return labels[source];
}

function sourceDetail(contact: PersistedContact) {
  if (contact.source === "digital_card" && contact.card_slot) {
    return `Digital Card Slot ${contact.card_slot}`;
  }

  return sourceLabel(contact.source);
}

function marketingConsentDetails(contact: PersistedContact): MarketingConsentDetails {
  const metadata = isRecord(contact.metadata) ? contact.metadata : {};
  const marketing = isRecord(metadata.marketing_consent)
    ? metadata.marketing_consent
    : null;
  const privacyNotice = isRecord(metadata.privacy_notice)
    ? metadata.privacy_notice
    : null;
  const enabled =
    typeof marketing?.enabled === "boolean" ? marketing.enabled : null;
  const optedIn =
    typeof marketing?.opted_in === "boolean" ? marketing.opted_in : null;
  const status = marketingConsentStatus(enabled, optedIn);

  return {
    status,
    enabled,
    optedIn,
    submittedAt:
      stringValue(marketing?.submitted_at) ||
      stringValue(metadata.submitted_at) ||
      contact.submitted_at,
    label: stringValue(marketing?.label),
    version: stringValue(marketing?.version),
    privacyNotice:
      stringValue(privacyNotice?.wording) || contact.consent_notice,
    privacyPolicyUrl:
      stringValue(privacyNotice?.privacy_policy_url) || contact.terms_url,
  };
}

function marketingConsentStatus(
  enabled: boolean | null,
  optedIn: boolean | null
): MarketingConsentStatus {
  if (optedIn === true) return "opted_in";
  if (enabled === true && optedIn === false) return "not_opted_in";
  return "unknown";
}

function statusLabel(status: ContactStatus) {
  const labels: Record<ContactStatus, string> = {
    new: "New",
    contacted: "Contacted",
    qualified: "Qualified",
    archived: "Archived",
  };

  return labels[status];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
