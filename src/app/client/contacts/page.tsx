"use client";

import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  ContactRound,
  Download,
  Eye,
  FileDown,
  Lock,
  MessageSquarePlus,
  Pencil,
  Phone,
  Plug,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  UploadCloud,
  UsersRound,
  X,
} from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";

const currentPlan = "pro" as
  | "free"
  | "pro"
  | "individual_pro"
  | "business"
  | "enterprise";
const isPaid = currentPlan !== "free";

type ContactSource = "QR" | "Wallet" | "Tap to Share" | "Public Page" | "Manual";
type ContactStatus = "New" | "Contacted" | "Qualified" | "Archived";
type CrmSyncStatus = "synced_hubspot" | "synced_salesforce" | "pending" | "failed" | "not_connected";
type PhoneContactStatus = "saved" | "not_saved" | "pending" | "failed";

type CapturedContact = {
  id: string;
  name: string;
  company: string;
  jobTitle: string;
  email: string;
  phone: string;
  website: string;
  source: ContactSource;
  capturedDate: string;
  crmSync: CrmSyncStatus;
  phoneContact: PhoneContactStatus;
  tags: string[];
  status: ContactStatus;
  notes: string;
};

type ContactFormState = {
  name: string;
  company: string;
  jobTitle: string;
  email: string;
  phone: string;
  website: string;
  notes: string;
  tags: string;
};

const initialContacts: CapturedContact[] = [
  {
    id: "contact-1",
    name: "Aisha Patel",
    company: "Northline Studio",
    jobTitle: "Creative Lead",
    email: "aisha@northline.example",
    phone: "+44 7700 900201",
    website: "northline.example",
    source: "QR",
    capturedDate: "13 May 2026",
    crmSync: "synced_hubspot",
    phoneContact: "saved",
    tags: ["Design", "Warm lead"],
    status: "New",
    notes: "Scanned the QR code after a design showcase.",
  },
  {
    id: "contact-2",
    name: "Daniel Brooks",
    company: "Vertex Group",
    jobTitle: "Sales Director",
    email: "daniel@vertex.example",
    phone: "+44 7700 900342",
    website: "vertex.example",
    source: "Tap to Share",
    capturedDate: "12 May 2026",
    crmSync: "pending",
    phoneContact: "pending",
    tags: ["Enterprise", "NFC"],
    status: "Qualified",
    notes: "Interested in enterprise onboarding for a sales team.",
  },
  {
    id: "contact-3",
    name: "Mia Chen",
    company: "Aster Labs",
    jobTitle: "Operations Manager",
    email: "mia@aster.example",
    phone: "+44 7700 900544",
    website: "aster.example",
    source: "Wallet",
    capturedDate: "10 May 2026",
    crmSync: "failed",
    phoneContact: "failed",
    tags: ["Wallet", "Follow-up"],
    status: "Contacted",
    notes: "Saved the wallet pass and requested pricing.",
  },
  {
    id: "contact-4",
    name: "Owen Clarke",
    company: "Bright Ledger",
    jobTitle: "Finance Partner",
    email: "owen@brightledger.example",
    phone: "+44 7700 900771",
    website: "brightledger.example",
    source: "Public Page",
    capturedDate: "9 May 2026",
    crmSync: "synced_salesforce",
    phoneContact: "not_saved",
    tags: ["Finance"],
    status: "New",
    notes: "Submitted details from the public card page.",
  },
  {
    id: "contact-5",
    name: "Nora Wilson",
    company: "Nova Retail",
    jobTitle: "Founder",
    email: "nora@novaretail.example",
    phone: "+44 7700 900882",
    website: "novaretail.example",
    source: "Manual",
    capturedDate: "8 May 2026",
    crmSync: "not_connected",
    phoneContact: "not_saved",
    tags: ["Retail", "Manual"],
    status: "Archived",
    notes: "Added after an in-person conversation.",
  },
];

const emptyForm: ContactFormState = {
  name: "",
  company: "",
  jobTitle: "",
  email: "",
  phone: "",
  website: "",
  notes: "",
  tags: "",
};

const crmConnected = true;

export default function ClientContactsPage() {
  const [contacts, setContacts] = useState<CapturedContact[]>(initialContacts);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [crmFilter, setCrmFilter] = useState("all");
  const [selectedContact, setSelectedContact] = useState<CapturedContact | null>(null);
  const [editingContact, setEditingContact] = useState<CapturedContact | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [formState, setFormState] = useState<ContactFormState>(emptyForm);
  const [message, setMessage] = useState("");

  const filteredContacts = useMemo(() => {
    const searchValue = search.trim().toLowerCase();

    return contacts.filter((contact) => {
      const matchesSearch =
        contact.name.toLowerCase().includes(searchValue) ||
        contact.company.toLowerCase().includes(searchValue) ||
        contact.email.toLowerCase().includes(searchValue) ||
        contact.phone.toLowerCase().includes(searchValue);
      const matchesSource =
        sourceFilter === "all" || contact.source === sourceFilter;
      const matchesCrm = crmFilter === "all" || crmStatusGroup(contact.crmSync) === crmFilter;
      return matchesSearch && matchesSource && matchesCrm;
    });
  }, [contacts, search, sourceFilter, crmFilter]);

  const stats = {
    total: contacts.length,
    newThisMonth: contacts.filter((contact) => contact.status === "New").length,
    synced: contacts.filter((contact) => contact.crmSync.startsWith("synced")).length,
    unsynced: contacts.filter((contact) => !contact.crmSync.startsWith("synced")).length,
    phoneSaved: contacts.filter((contact) => contact.phoneContact === "saved").length,
    conversionRate: "18.4%",
  };

  function openAddModal() {
    setFormState(emptyForm);
    setEditingContact(null);
    setAddModalOpen(true);
  }

  function openEditModal(contact: CapturedContact) {
    setFormState({
      name: contact.name,
      company: contact.company,
      jobTitle: contact.jobTitle,
      email: contact.email,
      phone: contact.phone,
      website: contact.website,
      notes: contact.notes,
      tags: contact.tags.join(", "),
    });
    setEditingContact(contact);
    setAddModalOpen(true);
  }

  function saveManualContact() {
    if (!formState.name.trim()) {
      setMessage("Full name is required.");
      return;
    }

    const nextContact: CapturedContact = {
      id: editingContact?.id || `contact-${Date.now()}`,
      name: formState.name.trim(),
      company: formState.company.trim(),
      jobTitle: formState.jobTitle.trim(),
      email: formState.email.trim(),
      phone: formState.phone.trim(),
      website: formState.website.trim(),
      source: "Manual",
      capturedDate: editingContact?.capturedDate || "13 May 2026",
      crmSync: editingContact?.crmSync || (crmConnected ? "pending" : "not_connected"),
      phoneContact: editingContact?.phoneContact || "not_saved",
      tags: formState.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      status: editingContact?.status || "New",
      notes: formState.notes.trim(),
    };

    setContacts((current) => {
      if (editingContact) {
        return current.map((contact) =>
          contact.id === editingContact.id ? nextContact : contact
        );
      }

      return [nextContact, ...current];
    });
    setAddModalOpen(false);
    setMessage("Contact added. CRM sync will run automatically when connected.");
  }

  function downloadCsv() {
    const rows = filteredContacts.map((contact) => ({
      name: contact.name,
      company: contact.company,
      job_title: contact.jobTitle,
      email: contact.email,
      phone: contact.phone,
      source: contact.source,
      captured_date: contact.capturedDate,
      crm_sync_status: crmStatusLabel(contact.crmSync),
      phone_contact_status: phoneStatusLabel(contact.phoneContact),
      status: contact.status,
      notes: contact.notes,
      tags: contact.tags.join("; "),
    }));
    const headers = Object.keys(rows[0] || {
      name: "",
      company: "",
      job_title: "",
      email: "",
      phone: "",
      source: "",
      captured_date: "",
      crm_sync_status: "",
      phone_contact_status: "",
      status: "",
      notes: "",
      tags: "",
    });
    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((header) => csvEscape(String(row[header as keyof typeof row] || "")))
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dmi-card-contacts.csv";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("CSV downloaded.");
  }

  function syncToCrm() {
    setMessage("CRM sync will be available after integrations are connected.");
  }

  function deleteContact(contact: CapturedContact) {
    setContacts((current) => current.filter((item) => item.id !== contact.id));
    setMessage("Contact deleted from mock list.");
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
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-bold">Contacts</h1>
              <span className="rounded-full border border-yellow-300/25 bg-yellow-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-yellow-100">
                Dev mode: Pro preview
              </span>
            </div>
            <p className="mt-3 max-w-3xl text-white/50">
              Manage leads captured from your digital business card.
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
            <ActionButton icon={Plug} onClick={syncToCrm}>
              Sync CRM
            </ActionButton>
          </div>
        </div>

        {message && (
          <div className="mb-6 rounded-2xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 px-5 py-4 text-sm text-purple-100">
            {message}
          </div>
        )}

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="Total Contacts" value={String(stats.total)} icon={UsersRound} />
          <SummaryCard label="New This Month" value={String(stats.newThisMonth)} icon={ContactRound} />
          <SummaryCard label="Synced to CRM" value={String(stats.synced)} icon={CheckCircle2} />
          <SummaryCard label="Unsynced" value={String(stats.unsynced)} icon={UploadCloud} />
          <SummaryCard label="Phone Contacts Saved" value={String(stats.phoneSaved)} icon={Phone} />
          <SummaryCard label="Conversion Rate" value={stats.conversionRate} icon={FileDown} />
        </div>

        <section className="relative rounded-3xl border border-white/10 bg-[#101935]/70 shadow-2xl shadow-black/20">
          {!isPaid && <LockedOverlay />}

          <div className={!isPaid ? "pointer-events-none blur-[2px]" : ""}>
            <div className="border-b border-white/10 p-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold">Lead Inbox</h2>
                  <p className="mt-2 text-sm text-white/45">
                    Search, filter, and action every contact captured from your card.
                  </p>
                </div>
                <div className="rounded-full border border-[#AC00FF]/25 bg-[#AC00FF]/10 px-3 py-1 text-xs font-semibold text-purple-100">
                  {filteredContacts.length} visible
                </div>
              </div>

              <div className="mt-6 grid gap-3 xl:grid-cols-[minmax(320px,1fr)_190px_190px_170px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, company, email, or phone"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#AC00FF]/60"
                  />
                </div>
                <FilterSelect
                  value={sourceFilter}
                  onChange={setSourceFilter}
                  label="All Sources"
                  options={["QR", "Wallet", "Tap to Share", "Public Page", "Manual"]}
                />
                <FilterSelect
                  value={crmFilter}
                  onChange={setCrmFilter}
                  label="All CRM"
                  options={["Synced", "Not Synced", "Failed"]}
                />
                <button
                  type="button"
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/55"
                >
                  Date range
                </button>
              </div>
            </div>

            <div className="max-h-[620px] overflow-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="sticky top-0 z-10 bg-[#070B1A] text-left text-white/45">
                  <tr className="border-b border-white/10">
                    <th className="p-4">Name</th>
                    <th className="p-4">Company</th>
                    <th className="p-4">Email</th>
                    <th className="p-4">Phone</th>
                    <th className="p-4">CRM Sync</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.map((contact) => (
                    <tr key={contact.id} className="border-b border-white/5">
                      <td className="p-4">
                        <p className="font-semibold">{contact.name}</p>
                        <p className="mt-1 text-xs text-white/40">{contact.jobTitle}</p>
                      </td>
                      <td className="p-4 text-white/65">{contact.company}</td>
                      <td className="p-4 text-white/65">{contact.email}</td>
                      <td className="p-4 text-white/65">{contact.phone}</td>
                      <td className="p-4">
                        <CrmBadge status={contact.crmSync} />
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <IconAction label="View" icon={Eye} onClick={() => setSelectedContact(contact)} />
                          <IconAction label="Edit" icon={Pencil} onClick={() => openEditModal(contact)} />
                          <IconAction label="Add Note" icon={StickyNote} onClick={() => setMessage("Note editor placeholder.")} />
                          <IconAction label="Delete" icon={Trash2} onClick={() => deleteContact(contact)} danger />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <LeadCapturePanel />

        {addModalOpen && (
          <ContactFormModal
            formState={formState}
            editing={Boolean(editingContact)}
            onChange={setFormState}
            onClose={() => setAddModalOpen(false)}
            onSave={saveManualContact}
          />
        )}

        {selectedContact && (
          <ContactDrawer
            contact={selectedContact}
            onClose={() => setSelectedContact(null)}
          />
        )}
      </section>
    </main>
  );
}

function LockedOverlay() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-[#070B1A]/55 p-6 backdrop-blur-[1px]">
      <div className="max-w-xl rounded-3xl border border-[#AC00FF]/30 bg-[#101935]/95 p-8 text-center shadow-2xl shadow-purple-950/40">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-[#AC00FF]/20">
          <Lock className="h-7 w-7 text-purple-100" />
        </div>
        <h2 className="mt-5 text-3xl font-semibold">Unlock Contacts</h2>
        <p className="mt-3 text-sm leading-6 text-white/60">
          Contacts is a paid lead management inbox. Upgrade to capture,
          filter, export, sync, and follow up with leads from your digital card.
        </p>
        <button
          type="button"
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-6 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20"
        >
          <Sparkles className="h-4 w-4" />
          Upgrade to Individual Pro
        </button>
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
  label,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-[#AC00FF]/60"
    >
      <option value="all">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function CrmBadge({ status }: { status: CrmSyncStatus }) {
  const dot: Record<CrmSyncStatus, string> = {
    synced_hubspot: "bg-green-300",
    synced_salesforce: "bg-green-300",
    pending: "bg-yellow-300",
    failed: "bg-red-300",
    not_connected: "bg-white/35",
  };

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/65">
      <span className={`h-2 w-2 rounded-full ${dot[status]}`} />
      {crmStatusShortLabel(status)}
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
        className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${
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

function LeadCapturePanel() {
  return (
    <section className="mt-6 rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-6 shadow-lg shadow-purple-950/15">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#AC00FF]/20">
          <MessageSquarePlus className="h-6 w-6 text-purple-100" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Lead capture flow</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
            When someone views your card, you can ask them to share their
            details before or after viewing your card.
          </p>
        </div>
      </div>
    </section>
  );
}

function ContactFormModal({
  formState,
  editing,
  onChange,
  onClose,
  onSave,
}: {
  formState: ContactFormState;
  editing: boolean;
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
      <div className="absolute inset-x-4 top-8 mx-auto max-w-3xl rounded-3xl border border-white/10 bg-[#101935] p-6 shadow-2xl shadow-black/40">
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
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <TextField label="Full name" value={formState.name} onChange={(value) => update("name", value)} />
          <TextField label="Company" value={formState.company} onChange={(value) => update("company", value)} />
          <TextField label="Job title" value={formState.jobTitle} onChange={(value) => update("jobTitle", value)} />
          <TextField label="Email" value={formState.email} onChange={(value) => update("email", value)} />
          <TextField label="Phone" value={formState.phone} onChange={(value) => update("phone", value)} />
          <TextField label="Website" value={formState.website} onChange={(value) => update("website", value)} />
          <TextField label="Source" value="Manual" onChange={() => undefined} disabled />
          <TextField label="Tags" value={formState.tags} onChange={(value) => update("tags", value)} />
        </div>

        <div className="mt-4">
          <TextArea label="Notes" value={formState.notes} onChange={(value) => update("notes", value)} />
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <ActionButton icon={X} onClick={onClose}>Cancel</ActionButton>
          <button
            type="button"
            onClick={onSave}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20"
          >
            <Plus className="h-4 w-4" />
            Save Contact
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactDrawer({
  contact,
  onClose,
}: {
  contact: CapturedContact;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close contact details"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <aside className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#070B1A]/95 p-6 shadow-2xl shadow-black/40">
        <div className="rounded-3xl border border-white/10 bg-[#101935]/85 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#AC00FF]">
                Contact Details
              </p>
              <h2 className="mt-2 text-3xl font-semibold">{contact.name}</h2>
              <p className="mt-1 text-white/50">{contact.company}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <DetailItem label="Name" value={contact.name} />
            <DetailItem label="Company" value={contact.company} />
            <DetailItem label="Job title" value={contact.jobTitle} />
            <DetailItem label="Email" value={contact.email} />
            <DetailItem label="Phone" value={contact.phone} />
            <DetailItem label="Website" value={contact.website} />
            <DetailItem label="Source" value={contact.source} />
            <DetailItem label="Captured date" value={contact.capturedDate} />
            <DetailItem label="CRM sync" value={crmStatusLabel(contact.crmSync)} />
            <DetailItem label="Phone contact" value={phoneStatusLabel(contact.phoneContact)} />
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold text-white/55">Notes</p>
            <p className="mt-2 text-sm leading-6 text-white/75">{contact.notes}</p>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold text-white/55">Tags</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {contact.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/60">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold text-white/55">Timeline</p>
            <div className="mt-4 space-y-3 text-sm text-white/55">
              <p>Contact captured from {contact.source}.</p>
              <p>CRM sync placeholder.</p>
              <p>Follow-up workflow placeholder.</p>
            </div>
          </div>
        </div>
      </aside>
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

function crmStatusGroup(status: CrmSyncStatus) {
  if (status.startsWith("synced")) return "Synced";
  if (status === "failed") return "Failed";
  return "Not Synced";
}

function crmStatusLabel(status: CrmSyncStatus) {
  const labels: Record<CrmSyncStatus, string> = {
    synced_hubspot: "Synced to HubSpot",
    synced_salesforce: "Synced to Salesforce",
    pending: "Pending sync",
    failed: "Sync failed",
    not_connected: "No CRM connected",
  };

  return labels[status];
}

function crmStatusShortLabel(status: CrmSyncStatus) {
  const labels: Record<CrmSyncStatus, string> = {
    synced_hubspot: "Synced to HubSpot",
    synced_salesforce: "Synced to Salesforce",
    pending: "Pending",
    failed: "Failed",
    not_connected: "No CRM",
  };

  return labels[status];
}

function phoneStatusLabel(status: PhoneContactStatus) {
  const labels: Record<PhoneContactStatus, string> = {
    saved: "Saved to iPhone/Android Contacts",
    not_saved: "Not saved",
    pending: "Pending",
    failed: "Failed",
  };

  return labels[status];
}

function csvEscape(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
