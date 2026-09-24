"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { accountsForArea, clientPage, individualPlanLabel } from "@/lib/admin-client-lists";
import AdminClientSheet from "./AdminClientSheet";
import styles from "./AdminClientsPage.module.css";
import Sidebar from "@/components/Sidebar";
import CardRenderer from "@/components/CardRenderer";
import { mutateAdminCard } from "@/lib/admin-card-mutations";
import { getAdminInventory } from "@/lib/admin-inventory";
import { getAdminTemplates } from "@/lib/templates";
import { mutateAdminClient, getAdminClientCounts, type ClientRelationshipCounts } from "@/lib/admin-client-contract";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, UploadCloud } from "lucide-react";

type Client = {
  id: string;
  full_name: string;
  company_name: string | null;
  email: string;
  phone: string | null;
  status: string;
  subscription_plan: string | null;
  account_type: string | null;
  billing_status: string | null;
  card_count: number;
  created_at: string;
  job_title?: string | null;
};

type ClientUser = {
  id: string;
  client_id: string | null;
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
  created_at?: string | null;
};

type Card = {
  id: string;
  client_id: string | null;
  template_id: string | null;
  card_name: string | null;
  name?: string | null;
  full_name: string | null;
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
  status: string | null;
  is_published: boolean | null;
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
  allowed_fields?: string[] | null;
};

type DetailsModal =
  | { type: "client"; data: Client }
  | { type: "admin"; data: Client }
  | { type: "staff"; data: ClientUser }
  | null;

type ImportRow = Record<string, string> & {
  company_name: string;
  full_name: string;
  job_title: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  whatsapp: string;
  linkedin: string;
  instagram: string;
  facebook: string;
  youtube: string;
  booking_link: string;
  custom_url: string;
};

const importHeaders = [
  "company_name",
  "full_name",
  "job_title",
  "email",
  "phone",
  "website",
  "address",
  "whatsapp",
  "linkedin",
  "instagram",
  "facebook",
  "youtube",
  "booking_link",
  "custom_url",
];

export default function AdminClientsPage({ area }: { area: "individual" | "business" }) {
  const { getToken } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientUsers, setClientUsers] = useState<ClientUser[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [relationships, setRelationships] = useState<ClientRelationshipCounts | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createdAccount, setCreatedAccount] = useState<{ id: string; name: string; email: string; status: string } | null>(null);
  const [statusTarget, setStatusTarget] = useState<Client | null>(null);
  const [notice, setNotice] = useState("");
  const [operationError, setOperationError] = useState("");
  const lastCreatedId = useRef<string | null>(null);
  const importPending = useRef(false);
  const [importOperation, setImportOperation] = useState<{ signature: string; id: string } | null>(null);
  const mutationPending = useRef(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  async function mutate(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, refreshSession = false) {
    if (mutationPending.current) return false;
    mutationPending.current = true;
    setMutationBusy(true);
    setOperationError("");
    try {
      let token: string | undefined;
      if (refreshSession) {
        try {
          const freshToken = await getToken({ skipCache: true });
          if (!freshToken?.trim()) throw new Error("Missing session token");
          token = freshToken;
        } catch {
          throw new Error("Could not refresh your Admin session. Please sign in again before retrying.");
        }
      }
      const result = await mutateAdminClient(path, method, body, token);
      lastCreatedId.current = result?.id || null;
      return true;
    }
    catch (error) { setOperationError(error instanceof Error ? error.message : "Operation failed."); return false; }
    finally { mutationPending.current = false; setMutationBusy(false); }
  }
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [fullListMode, setFullListMode] = useState<"individual" | "business" | null>(null);

  const [individualSearch, setIndividualSearch] = useState("");
  const [individualPlanFilter, setIndividualPlanFilter] = useState("all");
  const [individualBillingFilter, setIndividualBillingFilter] = useState("all");
  const [individualStatusFilter, setIndividualStatusFilter] = useState("all");
  const [businessSearch, setBusinessSearch] = useState("");
  const [businessStatusFilter, setBusinessStatusFilter] = useState("all");

  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const accountType = area;
  const [clientStatus, setClientStatus] = useState("active");

  const [staffFullName, setStaffFullName] = useState("");
  const [staffJobTitle, setStaffJobTitle] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [staffPhone, setStaffPhone] = useState("");
  const [importingFile, setImportingFile] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importRowCount, setImportRowCount] = useState(0);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [reviewImport, setReviewImport] = useState(false);

  const [detailsModal, setDetailsModal] = useState<DetailsModal>(null);
  const [detailsEditMode, setDetailsEditMode] = useState(false);
  const [detailsForm, setDetailsForm] = useState<Record<string, string>>({});
  const [previewCards, setPreviewCards] = useState<Card[]>([]);
  const [previewCardIndex, setPreviewCardIndex] = useState(0);
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);

  async function fetchClientData() {
    setLoading(true);
    try {
      const [nextClients, nextUsers, nextCards, nextTemplates, counts] = await Promise.all([
        getAdminInventory<Client>("clients"), getAdminInventory<ClientUser>("client-users"),
        getAdminInventory<Card>("cards"), getAdminTemplates(), getAdminClientCounts(),
      ]);
      setClients(nextClients.map(client => ({ ...client, card_count: counts.cardCounts[client.id] ?? 0 }))); setClientUsers(nextUsers); setCards(nextCards); setRelationships(counts);
      setTemplates(nextTemplates as Template[]);
    } catch (error) { setRelationships(null); setOperationError(error instanceof Error ? error.message : "Admin inventory failed to load. Please retry."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    async function loadClientData() {
      await fetchClientData();
    }

    void loadClientData();
  }, []);

  useEffect(() => {
    document.body.style.overflow = fullListMode ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [fullListMode]);

  async function createClientRecord() {
    if (createdAccount || mutationPending.current) return;
    if (accountType === "individual" && (!fullName || !email)) { setOperationError("Full name and email are required."); return; }
    if (accountType !== "individual" && (!companyName || !fullName || !email)) { setOperationError("Company name, primary contact and email are required."); return; }
    if (!await mutate("/api/admin/clients", "POST", {
      full_name: fullName || companyName, company_name: companyName, email, phone, account_type: accountType, status: clientStatus,
    })) return;
    setCreatedAccount({ id: lastCreatedId.current || "", name: companyName || fullName, email, status: clientStatus });
    if (lastCreatedId.current) {
      setNotice("Account created successfully.");
    } else {
      setOperationError("Account saved, but its ID was not returned. Refresh the inventory before managing it; do not resubmit.");
    }
    setFullName("");
    setCompanyName("");
    setEmail("");
    setPhone("");
    void fetchClientData();
  }

  function toggleClientStatus(client: Client) {
    if (mutationPending.current) return;
    setOperationError("");
    setStatusTarget(client);
  }

  async function confirmClientStatus(client: Client) {
    if (mutationPending.current) return;
    const nextStatus = client.status === "suspended" ? "active" : "suspended";
    if (!await mutate(`/api/admin/clients/${client.id}/status`, "PATCH", { status: nextStatus }, true)) return;
    setStatusTarget(null);
    setNotice(nextStatus === "suspended" ? "Client suspended successfully." : "Client reactivated successfully.");
    setDetailsForm(current => ({ ...current, status: nextStatus }));
    await fetchClientData();
  }

  async function createClientUser(client: Client) {
    if (!staffFullName || !staffEmail) return;
    if (!await mutate("/api/admin/client-users", "POST", {
      client_id: client.id, full_name: staffFullName, job_title: staffJobTitle, email: staffEmail, phone: staffPhone,
    })) return;
    setStaffFullName("");
    setStaffJobTitle("");
    setStaffEmail("");
    setStaffPhone("");
    setNotice("Staff member created successfully.");
    void fetchClientData();
  }

  async function deleteClientUser(user: ClientUser) {
    if (!window.confirm(`Delete user ${user.full_name || user.name}?`)) return;
    if (!await mutate(`/api/admin/client-users/${user.id}`, "DELETE")) return;
    setNotice("Staff member deleted successfully.");
    void fetchClientData();
  }

  async function deleteCard(card: Card) {
    const confirmed = window.confirm(
      "Delete this card permanently? This may affect the client’s card limit and public card URL."
    );

    if (!confirmed) return;

    try { await mutateAdminCard(`/api/admin/cards/${card.id}`, "DELETE"); }
    catch (error) { setOperationError(error instanceof Error ? error.message : "Card deletion failed."); return; }

    const remainingPreviewCards = previewCards.filter((item) => item.id !== card.id);
    setPreviewCards(remainingPreviewCards);
    setPreviewCardIndex((current) =>
      remainingPreviewCards.length === 0
        ? 0
        : Math.min(current, remainingPreviewCards.length - 1)
    );

    await fetchClientData();
  }

  function openClientDetails(client: Client) {
    setOperationError("");
    setDetailsModal({ type: "client", data: client });
    setDetailsEditMode(false);
    setDetailsForm({
      full_name: client.full_name || "",
      company_name: client.company_name || "",
      email: client.email || "",
      phone: client.phone || "",
      account_type: client.account_type || "",
      subscription_plan: client.subscription_plan || "",
      billing_status: client.billing_status || "",
      status: client.status || "",

    });
  }

  function openAdminContactDetails(client: Client) {
    setDetailsModal({ type: "admin", data: client });
    setDetailsEditMode(false);
    setDetailsForm({
      full_name: client.full_name || "",
      email: client.email || "",
      phone: client.phone || "",
      job_title: client.job_title || "",
    });
  }

  function openStaffDetails(user: ClientUser) {
    const company = clients.find((client) => client.id === user.client_id);
    setDetailsModal({ type: "staff", data: user });
    setDetailsEditMode(false);
    setDetailsForm({
      company_name: company?.company_name || company?.full_name || "",
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
      status: user.status || "active",
    });
  }

  function closeDetailsModal() {
    setDetailsModal(null);
    setDetailsEditMode(false);
    setDetailsForm({});
  }

  async function saveDetailsChanges() {
    if (!detailsModal) return;
    if (!detailsForm.full_name?.trim()) return setOperationError("Full name is required.");
    if ((detailsModal.type === "client" || detailsModal.type === "admin") && !detailsForm.email?.trim()) {
      return setOperationError("Email is required.");
    }

    const fields = detailsModal.type === "client"
      ? ["full_name", "company_name", "email", "phone", "account_type"]
      : detailsModal.type === "admin" ? ["full_name", "email", "phone"]
      : ["full_name", "job_title", "email", "phone", "website", "address", "whatsapp", "linkedin", "instagram", "facebook", "youtube", "booking_link", "custom_url", "status"];
    const path = detailsModal.type === "staff" ? "client-users" : "clients";
    if (!await mutate(`/api/admin/${path}/${detailsModal.data.id}`, "PATCH",
      Object.fromEntries(fields.map(key => [key, detailsForm[key] || ""])))) return;

    await fetchClientData();
    setNotice("Details updated successfully.");
    setDetailsEditMode(false);
  }

  function downloadExcelTemplate() {
    const row = [
      "Acme Ltd",
      "John Smith",
      "Sales Director",
      "john@acme.com",
      "+44 7111 111111",
      "https://acme.com",
      "1 Acme Street, London",
      "+44 7111 111111",
      "https://linkedin.com/in/johnsmith",
      "https://instagram.com/acme",
      "https://facebook.com/acme",
      "https://youtube.com/@acme",
      "https://acme.com/book",
      "https://acme.com/john",
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([importHeaders, row]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Company Import");
    XLSX.writeFile(workbook, "dmi-cards-company-import-template.xlsx");
  }

  async function prepareImportFile(file: File) {
    try {
      const rows = await parseImportFile(file);
      setImportFileName(file.name);
      setImportRowCount(rows.length);
      setImportRows(rows.map(normalizeImportRow));
      setReviewImport(true);
      setOperationError("");
    } catch { setOperationError("Could not read the import file. Choose a valid CSV or Excel file."); }
  }

  function cancelImport() {
    setImportFileName("");
    setImportRowCount(0);
    setImportRows([]);
    setReviewImport(false);
  }

  function updateImportRow(index: number, field: keyof ImportRow, value: string) {
    setImportRows((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))
    );
  }

  async function confirmImport() {
    if (importPending.current) return;
    importPending.current = true;
    setImportingFile(true);
    try {
      const groups = new Map<string, ImportRow[]>();
      for (const row of importRows) {
        const company = row.company_name.trim();
        if (!company || !row.full_name.trim()) throw new Error("Every import row requires a company and full name.");
        groups.set(company, [...(groups.get(company) || []), row]);
      }
      const companies = [...groups].map(([company, rows]) => ({
        client: { company_name: company, full_name: rows[0].full_name, email: rows[0].email,
          phone: rows[0].phone, account_type: "business", status: clientStatus },
        staff: rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "company_name"))),
      }));
      const signature = JSON.stringify(companies);
      const operation = importOperation?.signature === signature ? importOperation : { signature, id: crypto.randomUUID() };
      setImportOperation(operation);
      await mutateAdminClient("/api/admin/clients/import", "POST", { operationId: operation.id, companies });
      await fetchClientData();
      setNotice(`Imported ${companies.length} companies and ${importRows.length} staff contacts. No login accounts or subscriptions were created.`);
      setImportOperation(null);
      cancelImport();
    } catch (error) { setOperationError(error instanceof Error ? error.message : "Import failed. Keep the import unchanged to retry safely."); }
    finally { importPending.current = false; setImportingFile(false); }
  }

  function toggleCompany(clientId: string) {
    setFullListMode(null);
    setExpandedCompany((current) => (current === clientId ? null : clientId));
    setStaffFullName("");
    setStaffJobTitle("");
    setStaffEmail("");
    setStaffPhone("");
  }

  function findCardsForUser(companyId: string, user: ClientUser) {
    const ids = new Set(relationships?.staffCards[user.id] || []);
    return cards.filter(card => card.client_id === companyId && ids.has(card.id));
  }

  function openCardPreview(userCards: Card[], user: ClientUser) {
    setPreviewCards(userCards);
    setPreviewUserId(user.id);
    setPreviewCardIndex(0);
  }

  const individualClients = useMemo(() => accountsForArea(clients, "individual"), [clients]);
  const businessClients = useMemo(() => accountsForArea(clients, "business"), [clients]);
  const filteredIndividualClients = useMemo(() => {
    return individualClients.filter((client) => {
      const search = individualSearch.toLowerCase();
      return (
        (client.full_name.toLowerCase().includes(search) ||
          client.email.toLowerCase().includes(search) ||
          (client.company_name || "").toLowerCase().includes(search)) &&
        (individualPlanFilter === "all" || individualPlanLabel(client.subscription_plan).toLowerCase() === individualPlanFilter) &&
        (individualBillingFilter === "all" || client.billing_status === individualBillingFilter) &&
        (individualStatusFilter === "all" || client.status === individualStatusFilter)
      );
    });
  }, [individualClients, individualSearch, individualPlanFilter, individualBillingFilter, individualStatusFilter]);
  const filteredBusinessClients = useMemo(() => {
    return businessClients.filter((client) => {
      const search = businessSearch.toLowerCase();
      const company = client.company_name || client.full_name;
      return (
        (company.toLowerCase().includes(search) || client.full_name.toLowerCase().includes(search) || client.email.toLowerCase().includes(search)) &&
        (businessStatusFilter === "all" || client.status === businessStatusFilter)
      );
    });
  }, [businessClients, businessSearch, businessStatusFilter]);

  const filterKey = JSON.stringify([fullListMode, individualSearch, individualPlanFilter, individualBillingFilter, individualStatusFilter, businessSearch, businessStatusFilter]);
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const fullPage = clientPage(fullListMode === "business" ? filteredBusinessClients : filteredIndividualClients, pagination.key === filterKey ? pagination.page : 1);
  const importCompanies = useMemo(() => {
    const grouped = new Map<string, ImportRow[]>();
    importRows.forEach((row) => {
      const key = row.company_name.trim() || "Missing company";
      grouped.set(key, [...(grouped.get(key) || []), row]);
    });
    return Array.from(grouped.entries()).map(([company, rows]) => ({
      company,
      primaryContact: rows[0]?.full_name || "-",
      totalUsers: rows.filter((row) => row.company_name.trim() && row.full_name.trim()).length,
      missingFields: [
        ...new Set(
          rows.flatMap((row) => [
            ...(!row.company_name.trim() ? ["company_name"] : []),
            ...(!row.full_name.trim() ? ["full_name"] : []),
          ])
        ),
      ],
    }));
  }, [importRows]);

  const areaAccounts = area === "individual" ? individualClients : businessClients;
  const metricsReady = !loading && Boolean(relationships);
  const latestPreviewUser = previewUserId
    ? clientUsers.find((user) => user.id === previewUserId) || null
    : null;
  const latestPreviewCards = previewCards.map(
    (previewCard) => cards.find((card) => card.id === previewCard.id) || previewCard
  );

  return (
    <main className={styles.page}>
      <div className={styles.desktopSidebar}><Sidebar /></div>
      <section className={styles.content}>
        <button className={styles.menuButton} onClick={() => setMenuOpen(true)} aria-label="Open Admin navigation">☰ Menu</button>
        <div className={styles.pageHeader}>
          <div><h1 className="text-3xl font-bold">{area === "individual" ? "Individual Clients" : "Business Clients"}</h1>
          <p className="mt-3 max-w-4xl text-slate-500">
            {area === "individual" ? "Manage personal DMI Cards customers and their cards." : "Manage company accounts, staff and digital cards."}
          </p></div>
          <div className={styles.headerActions}>
            <button className={styles.primary} onClick={() => { setCreatedAccount(null); setOperationError(""); setNotice(""); setCreateOpen(true); }}>+ {area === "individual" ? "Add Individual Client" : "Add Business"}</button>
            <button onClick={() => setFullListMode(area)}>View All {area === "individual" ? "Clients" : "Companies"}</button>
            {area === "business" && <button onClick={() => { setOperationError(""); setNotice(""); setImportOpen(true); }}>Import</button>}
          </div>
        </div>

        <div className={styles.kpis}>
          <StatCard label={area === "individual" ? "Total Individuals" : "Companies"} value={metricsReady ? areaAccounts.length : "—"} caption={area === "individual" ? "Individual accounts" : "Includes legacy Enterprise accounts"} />
          <StatCard label={area === "individual" ? "Active" : "Active Companies"} value={metricsReady ? areaAccounts.filter(row => row.status === "active").length : "—"} caption="Account status" />
          <StatCard label={area === "individual" ? "Suspended" : "Suspended Companies"} value={metricsReady ? areaAccounts.filter(row => row.status === "suspended").length : "—"} caption="Account status" />
          {area === "business" && <>
            <StatCard label="People" value={metricsReady ? relationships?.areas.businessPeople ?? "—" : "—"} caption="Company staff memberships" />
            <StatCard label="Activated Users" value={metricsReady ? relationships?.areas.businessActivatedUsers ?? "—" : "—"} caption="Distinct verified company/staff identities" />
          </>}
          <StatCard label="Cards" value={metricsReady ? (area === "individual" ? relationships?.areas.individualCards : relationships?.areas.businessCards) ?? "—" : "—"} caption="Actual cards in this account area" />
        </div>

        {(createOpen || importOpen) && <AdminClientSheet title={importOpen ? "Bulk Company Import" : createdAccount ? "Account created" : area === "individual" ? "Add Individual Client" : "Add Business"} busy={mutationBusy || importingFile} onClose={() => { setCreateOpen(false); setImportOpen(false); }} wide={importOpen} notice={notice}>
          {operationError && <p role="alert" className={styles.error}>{operationError}</p>}
          {createdAccount && !importOpen ? <div className={styles.onboarding}>
            <div className={styles.successMark} aria-hidden="true">✓</div>
            <h3>Account created</h3><strong>{createdAccount.name}</strong><p>{createdAccount.email}</p>
            <p>Status: {createdAccount.status}</p>
            {area === "individual" && <p>Plan: Free · maximum 1 card. Cards: {clients.find(client => client.id === createdAccount.id)?.card_count ?? "Checking inventory…"}</p>}
            <h4>Next steps</h4>
            <button disabled title="Invitation delivery is not implemented">Send Invitation — Coming soon</button>
            {area === "individual" && <button disabled title="Individual card creation requires the client’s authenticated account">Create First Card — client sign-in required</button>}
            <button className={styles.primary} disabled={!createdAccount.id} onClick={() => {
              const saved = clients.find(client => client.id === createdAccount.id);
              if (!saved) { setOperationError("The account is saved. Refresh its inventory before managing it."); void fetchClientData(); return; }
              setCreateOpen(false);
              if (area === "business") toggleCompany(saved.id); else openClientDetails(saved);
            }}>{area === "business" ? "Manage Company / Add Staff" : "View / Manage Client"}</button>
            {area === "business" && <button onClick={() => { setCreateOpen(false); setImportOpen(true); }}>Open existing company + staff import</button>}
            <button onClick={() => setCreateOpen(false)}>Done</button>
          </div> : <>
        <AddClientSection mode={importOpen ? "import" : "create"}
          fullName={fullName}
          setFullName={setFullName}
          companyName={companyName}
          setCompanyName={setCompanyName}
          email={email}
          setEmail={setEmail}
          phone={phone}
          setPhone={setPhone}
          accountType={accountType}
          busy={mutationBusy}
          clientStatus={clientStatus}
          setClientStatus={setClientStatus}
          createClientRecord={createClientRecord}
          importingFile={importingFile}
          prepareImportFile={prepareImportFile}
          downloadExcelTemplate={downloadExcelTemplate}
          importFileName={importFileName}
          importRowCount={importRowCount}
          reviewImport={reviewImport}
          importCompanies={importCompanies}
          importRows={importRows}
          updateImportRow={updateImportRow}
          confirmImport={confirmImport}
          cancelImport={cancelImport}
        />
          </>}
        </AdminClientSheet>}


        <fieldset disabled={mutationBusy} aria-busy={mutationBusy} className="min-w-0">
        {mutationBusy && <p role="status">Saving changes…</p>}
        {area === "individual" && <ClientSection
          title="Recent Individual Clients"
          description="Individual accounts are shown as people."
          count={Math.min(10, individualClients.length)}
          onViewFullList={() => setFullListMode("individual")}
          filters={null}
        >
          <IndividualTable
            loading={loading}
            clients={individualClients.slice(0, 10)}
            openClientDetails={openClientDetails}
            toggleClientStatus={toggleClientStatus}
          />
        </ClientSection>}

        {area === "business" && <ClientSection
          title="Recent Companies"
          description="Business companies and historical Enterprise accounts."
          count={Math.min(10, businessClients.length)}
          onViewFullList={() => setFullListMode("business")}
          filters={null}
        >
          <BusinessTable
            loading={loading}
            companies={businessClients.slice(0, 10)}
            managementCompanies={businessClients}
            busy={mutationBusy}
            error={operationError}
            notice={notice}
            onCloseManagement={() => setExpandedCompany(null)}
            clientUsers={clientUsers}
            cards={cards}
            expandedCompany={expandedCompany}
            toggleCompany={toggleCompany}
            toggleClientStatus={toggleClientStatus}
            openAdminContactDetails={openAdminContactDetails}
            staffFullName={staffFullName}
            setStaffFullName={setStaffFullName}
            staffJobTitle={staffJobTitle}
            setStaffJobTitle={setStaffJobTitle}
            staffEmail={staffEmail}
            setStaffEmail={setStaffEmail}
            staffPhone={staffPhone}
            setStaffPhone={setStaffPhone}
            createClientUser={createClientUser}
            findCardsForUser={findCardsForUser}
            openStaffDetails={openStaffDetails}
            openCardPreview={openCardPreview}
            deleteClientUser={deleteClientUser}
          />
        </ClientSection>}
        </fieldset>
      </section>

      {notice && <div role="status" className={styles.toast}>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
      {operationError && !createOpen && !importOpen && !detailsModal && !expandedCompany && !statusTarget && <div role="alert" className={styles.error}>{operationError}</div>}
      {menuOpen && <AdminClientSheet title="DMI Cards Admin" onClose={() => setMenuOpen(false)}><div className={styles.mobileSidebar}><Sidebar /></div></AdminClientSheet>}
      {statusTarget && <AdminClientSheet title={statusTarget.status === "suspended" ? "Reactivate Client" : "Suspend Client"} busy={mutationBusy} onClose={() => { setStatusTarget(null); setOperationError(""); }} confirm>
        <div className={styles.confirmation}>
          <span aria-hidden="true" className={styles.warning}>!</span>
          <h3>{statusTarget.company_name || statusTarget.full_name}</h3>
          <p>{statusTarget.status === "suspended" ? "Restore Client Portal access using the existing account data." : "This stops Client Portal access. Cards, contacts, billing records, Wallet passes and account data remain intact."}</p>
          {operationError && <p role="alert" className={styles.error}>{operationError}</p>}
          <div className={styles.headerActions}>
            <button disabled={mutationBusy} onClick={() => { setStatusTarget(null); setOperationError(""); }}>Cancel</button>
            <button disabled={mutationBusy} className={statusTarget.status === "suspended" ? styles.primary : styles.danger} onClick={() => void confirmClientStatus(statusTarget)}>{mutationBusy ? (statusTarget.status === "suspended" ? "Reactivating…" : "Suspending…") : (statusTarget.status === "suspended" ? "Reactivate Client" : "Suspend Client")}</button>
          </div>
        </div>
      </AdminClientSheet>}
      {fullListMode && (
        <FullListModal
          title={fullListMode === "individual" ? "All Individual Clients" : "All Companies"}
          onClose={() => setFullListMode(null)}
        >
          <fieldset disabled={mutationBusy} aria-busy={mutationBusy} className="min-w-0">
          {fullListMode === "individual" ? (
            <div className="flex h-full min-h-0 flex-col">
              <IndividualFilters
                search={individualSearch}
                setSearch={setIndividualSearch}
                plan={individualPlanFilter}
                setPlan={setIndividualPlanFilter}
                billing={individualBillingFilter}
                setBilling={setIndividualBillingFilter}
                status={individualStatusFilter}
                setStatus={setIndividualStatusFilter}
              />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <IndividualTable
                  loading={loading}
                  clients={fullPage.rows}
                  openClientDetails={openClientDetails}
                  toggleClientStatus={toggleClientStatus}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <BusinessFilters
                search={businessSearch}
                setSearch={setBusinessSearch}
                status={businessStatusFilter}
                setStatus={setBusinessStatusFilter}
              />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <BusinessTable
                  loading={loading}
                  companies={fullPage.rows}
                  clientUsers={clientUsers}
                  cards={cards}
                  expandedCompany={expandedCompany}
                  toggleCompany={toggleCompany}
                  toggleClientStatus={toggleClientStatus}
                  openAdminContactDetails={openAdminContactDetails}
                  staffFullName={staffFullName}
                  setStaffFullName={setStaffFullName}
                  staffJobTitle={staffJobTitle}
                  setStaffJobTitle={setStaffJobTitle}
                  staffEmail={staffEmail}
                  setStaffEmail={setStaffEmail}
                  staffPhone={staffPhone}
                  setStaffPhone={setStaffPhone}
                  createClientUser={createClientUser}
                  findCardsForUser={findCardsForUser}
                  openStaffDetails={openStaffDetails}
                  openCardPreview={openCardPreview}
                  deleteClientUser={deleteClientUser}
                />
              </div>
            </div>
          )}
          </fieldset>
          <div className="flex items-center justify-between border-t border-slate-200 p-5">
            <button className={fullListMode === "individual" ? styles.paginationPill : undefined} disabled={fullPage.page <= 1} onClick={() => setPagination({ key: filterKey, page: fullPage.page - 1 })}>Previous</button>
            <span>Page {fullPage.page} of {fullPage.pages}</span>
            <button className={fullListMode === "individual" ? styles.paginationPill : undefined} disabled={fullPage.page >= fullPage.pages} onClick={() => setPagination({ key: filterKey, page: fullPage.page + 1 })}>Next</button>
          </div>
        </FullListModal>
      )}

      {detailsModal && (
        <UserDetailsModal
          busy={mutationBusy}
          error={operationError}
          notice={notice}
          onStatus={() => {
            if (detailsModal.type === "staff") return;
            toggleClientStatus(clients.find(client => client.id === detailsModal.data.id) || detailsModal.data);
          }}
          modal={detailsModal}
          form={detailsForm}
          editMode={detailsEditMode}
          onChange={(field, value) => setDetailsForm((current) => ({ ...current, [field]: value }))}
          onClose={() => { if (!mutationPending.current) closeDetailsModal(); }}
          onEdit={() => setDetailsEditMode(true)}
          onCancel={() => {
            if (detailsModal.type === "client") openClientDetails(detailsModal.data);
            else if (detailsModal.type === "admin") openAdminContactDetails(detailsModal.data);
            else openStaffDetails(detailsModal.data);
          }}
          onSave={saveDetailsChanges}
        />
      )}

      {previewCards.length > 0 && (
        <PublishedCardPreviewModal
          cards={latestPreviewCards}
          user={latestPreviewUser}
          currentIndex={previewCardIndex}
          templates={templates}
          onPrevious={() =>
            setPreviewCardIndex((current) => (current === 0 ? previewCards.length - 1 : current - 1))
          }
          onNext={() =>
            setPreviewCardIndex((current) => (current === previewCards.length - 1 ? 0 : current + 1))
          }
          onClose={() => {
            setPreviewCards([]);
            setPreviewCardIndex(0);
            setPreviewUserId(null);
          }}
          onDeleteCard={deleteCard}
        />
      )}
    </main>
  );
}

function AddClientSection(props: {
  mode: "create" | "import";
  fullName: string;
  setFullName: (value: string) => void;
  companyName: string;
  setCompanyName: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  phone: string;
  setPhone: (value: string) => void;
  accountType: string;
  busy: boolean;
  clientStatus: string;
  setClientStatus: (value: string) => void;
  createClientRecord: () => void;
  importingFile: boolean;
  prepareImportFile: (file: File) => void | Promise<void>;
  downloadExcelTemplate: () => void;
  importFileName: string;
  importRowCount: number;
  reviewImport: boolean;
  importCompanies: { company: string; primaryContact: string; totalUsers: number; missingFields: string[] }[];
  importRows: ImportRow[];
  updateImportRow: (index: number, field: keyof ImportRow, value: string) => void;
  confirmImport: () => void;
  cancelImport: () => void;
}) {
  return (
    <div className="space-y-4">
      {props.mode === "create" && <><h2 className="text-2xl font-semibold">{props.accountType === "individual" ? "Add Individual Client" : "Add Business"}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        {props.accountType === "individual" ? "Create a personal Free account." : "Create a company first; staff can be added later."}
      </p>
      <div className={props.accountType === "individual" ? styles.stackedFields : "mt-7 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5"}>
        <fieldset disabled={props.busy} aria-busy={props.busy} className="contents">
        {props.accountType === "business" && <Field label="Company Name">
          <input value={props.companyName} onChange={(e) => props.setCompanyName(e.target.value)} className={styles.input} />
        </Field>}
        <Field label={props.accountType === "individual" ? "Full Name" : "Primary Contact Name"}>
          <input value={props.fullName} onChange={(e) => props.setFullName(e.target.value)} className={styles.input} />
        </Field>
        <Field label={props.accountType === "business" ? "Primary Contact Email" : "Email"}>
          <input value={props.email} onChange={(e) => props.setEmail(e.target.value)} className={styles.input} />
        </Field>
        <Field label="Phone Number">
          <input value={props.phone} onChange={(e) => props.setPhone(e.target.value)} className={styles.input} />
        </Field>
        {props.accountType === "individual" && <Field label="Plan">
          <select aria-label="Plan" value="free" disabled className={styles.input}>
            <option value="free">Free</option>
            <option value="pro" disabled>Pro (not available here yet)</option>
          </select>
          <span className="mt-2 block text-xs text-slate-500">Free: 1 card. Pro: up to 3 premium cards. Pro grants and subscription links are not available here yet.</span>
        </Field>}
        {/* TODO: Send Pro Subscription Link. Complimentary Pro needs a reviewed server entitlement grant, not a legacy plan label. */}
        {props.accountType === "business" && <Field label="Status">
          <select value={props.clientStatus} onChange={(e) => props.setClientStatus(e.target.value)} className={styles.input}>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>}
        </fieldset>
      </div>
      <button disabled={props.busy} onClick={props.createClientRecord} className={`mt-7 rounded-2xl bg-gradient-to-r from-pink-600 to-purple-700 text-white px-6 py-3 font-medium transition hover:opacity-90 ${props.accountType === "individual" ? `${styles.primary} ${styles.individualPrimary}` : ""}`}>
        {props.busy ? "Creating…" : "Create Account"}
      </button></>}

      {props.mode === "import" && props.accountType === "business" && <div className="space-y-4">
        <div className="grid gap-6 xl:grid-cols-[1fr_520px]">
          <div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-50 text-purple-700 ring-1 ring-[#AC00FF]/30">
              <FileSpreadsheet size={22} />
            </div>
            <h3 className="mt-4 text-2xl font-semibold">Bulk Company Import</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Imports companies and staff together from Excel or CSV. Company-scoped staff import is planned; billing is not configured here.
            </p>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button type="button" onClick={props.downloadExcelTemplate} className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-5 text-sm font-medium transition hover:bg-white/15">
                <Download size={18} />
                Download Template
              </button>
              <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-600 to-purple-700 text-white px-5 text-sm font-medium">
                <UploadCloud size={18} />
                {props.importingFile ? "Importing..." : "Upload Company File"}
                <input type="file" accept=".csv,.xlsx,.xls" disabled={props.importingFile} className="sr-only" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void props.prepareImportFile(file);
                  e.target.value = "";
                }} />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <ImportStatus label="Selected file" value={props.importFileName || "-"} />
              <ImportStatus label="Rows detected" value={String(props.importRowCount)} />
              <ImportStatus label="Status" value={props.importingFile ? "Importing" : "Ready"} />
            </div>
          </div>
        </div>
      </div>}

      {props.mode === "import" && props.accountType === "business" && props.reviewImport && (
        <div className="mt-8 rounded-3xl border border-[#AC00FF]/25 bg-slate-50/55 p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h3 className="text-2xl font-semibold">Review Import</h3>
              <p className="mt-2 text-sm text-slate-500">Review and edit staff users before anything is saved.</p>
            </div>
            <div className="flex gap-3">
              <button disabled={props.importingFile} onClick={props.cancelImport} className="rounded-2xl bg-slate-50 px-5 py-3 text-sm font-medium">Cancel Import</button>
              <button disabled={props.importingFile} onClick={props.confirmImport} className="rounded-2xl bg-gradient-to-r from-pink-600 to-purple-700 text-white px-5 py-3 text-sm font-medium">Confirm Import</button>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
            {props.importCompanies.map((company) => (
              <div key={company.company} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">Company name</p>
                <p className="mt-1 font-medium">{company.company}</p>
                <p className="mt-3 text-xs text-slate-500">First staff user</p>
                <p className="mt-1 text-sm text-slate-600">{company.primaryContact}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
            <table className={styles.importTable}>
              <thead className="bg-white text-left text-slate-500">
                <tr>{importHeaders.map((header) => <th key={header} className="p-3 capitalize">{header.replace("_", " ")}</th>)}</tr>
              </thead>
              <tbody>
                {props.importRows.map((row, index) => (
                  <tr key={`${row.company_name}-${row.email}-${index}`} className="border-t border-slate-100">
                    {(importHeaders as (keyof ImportRow)[]).map((field) => (
                      <td key={field} data-label={field.replaceAll("_", " ")} className="p-2">
                        <input aria-label={`Row ${index + 1} ${field.replaceAll("_", " ")}`} disabled={props.importingFile} value={row[field] || ""} onChange={(e) => props.updateImportRow(index, field, e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-[#AC00FF]" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientSection({ title, description, count, onViewFullList, filters, children }: {
  title: string;
  description: string;
  count: number;
  onViewFullList: () => void;
  filters: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8 rounded-3xl border border-slate-200 bg-white">
      <SectionHeader title={title} description={description} count={count} onViewFullList={onViewFullList} />
      {filters}
      <div className="max-h-[520px] overflow-y-auto">{children}</div>
    </div>
  );
}

function IndividualFilters(props: {
  search: string;
  setSearch: (value: string) => void;
  plan: string;
  setPlan: (value: string) => void;
  billing: string;
  setBilling: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
}) {
  return (
    <div className="border-b border-slate-200 p-6">
      <div className={styles.filters}>
        <input aria-label="Search people, company or email" placeholder="Search" value={props.search} onChange={(e) => props.setSearch(e.target.value)} className={styles.input} />
        <FilterSelect value={props.plan} onChange={props.setPlan} label="All Plans" options={["free", "pro"]} />
        <FilterSelect value={props.billing} onChange={props.setBilling} label="All Billing" options={["paid", "trial", "overdue", "cancelled"]} />
        <FilterSelect value={props.status} onChange={props.setStatus} label="All Statuses" options={["active", "pending", "suspended"]} />
      </div>
      <p className="mt-3 text-xs text-slate-500">Legacy plan and billing labels are informational; Stripe controls access. Use Suspend/Reactivate for account status.</p>
    </div>
  );
}

function BusinessFilters(props: { search: string; setSearch: (value: string) => void; status: string; setStatus: (value: string) => void }) {
  return <div className="border-b border-slate-200 p-6"><div className={styles.filters}>
    <input aria-label="Search company, contact or email" placeholder="Search company, contact or email" value={props.search} onChange={e => props.setSearch(e.target.value)} className={styles.input} />
    <FilterSelect value={props.status} onChange={props.setStatus} label="All Statuses" options={["active", "pending", "suspended"]} />
  </div></div>;
}

function IndividualTable(props: {
  loading: boolean;
  clients: Client[];
  openClientDetails: (client: Client) => void;
  toggleClientStatus: (client: Client) => void;
}) {
  return (
    <table className={styles.inventoryTable}>
      <thead className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50">
        <tr className="text-left text-slate-600">
          <th className="p-5">Client</th><th className="p-5">Email</th><th className="p-5">Plan</th><th className="p-5">Cards</th><th className="p-5">Status</th><th className="p-5">Manage</th>
        </tr>
      </thead>
      <tbody>
        {props.loading ? <TableMessage message="Loading individual clients..." /> : props.clients.length === 0 ? <TableMessage message="No matching individual clients found." /> : props.clients.map((client) => (
          <tr key={client.id} className="border-t border-slate-100 hover:bg-white">
            <td data-label="Client" className="p-5 font-medium">{client.full_name}</td>
            <td data-label="Email" className="p-5 text-slate-600">{client.email}</td>
            <td data-label="Plan (display label)" className="p-5 capitalize text-slate-600">{individualPlanLabel(client.subscription_plan)}</td>
            <td data-label="Cards" className="p-5 text-slate-600">{client.card_count ?? 0}</td>
            <td data-label="Status" className="p-5"><StatusBadge status={client.status} /></td>
            <td data-label="Manage" className="p-5"><ClientActions client={client} onView={props.openClientDetails} onToggle={props.toggleClientStatus} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BusinessTable(props: {
  loading: boolean;
  companies: Client[];
  managementCompanies?: Client[];
  busy?: boolean;
  error?: string;
  notice?: string;
  onCloseManagement?: () => void;
  clientUsers: ClientUser[];
  cards: Card[];
  expandedCompany: string | null;
  toggleCompany: (id: string) => void;
  toggleClientStatus: (client: Client) => void;
  openAdminContactDetails: (client: Client) => void;
  staffFullName: string;
  setStaffFullName: (value: string) => void;
  staffJobTitle: string;
  setStaffJobTitle: (value: string) => void;
  staffEmail: string;
  setStaffEmail: (value: string) => void;
  staffPhone: string;
  setStaffPhone: (value: string) => void;
  createClientUser: (client: Client) => void;
  findCardsForUser: (companyId: string, user: ClientUser) => Card[];
  openStaffDetails: (user: ClientUser) => void;
  openCardPreview: (cards: Card[], user: ClientUser) => void;
  deleteClientUser: (user: ClientUser) => void;
}) {
  return (
    <><table className={styles.inventoryTable}>
      <thead className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50">
        <tr className="text-left text-slate-600">
          <th className="p-5">Company</th><th className="p-5">Primary Contact</th><th className="p-5">People</th><th className="p-5">Cards</th><th className="p-5">Status</th><th className="p-5">Manage</th>
        </tr>
      </thead>
        {props.loading ? <tbody><TableMessage message="Loading company accounts..." /></tbody> : props.companies.length === 0 ? <tbody><TableMessage message="No matching company accounts found." /></tbody> : props.companies.map((company) => {
          const users = props.clientUsers.filter((user) => user.client_id === company.id);
          const companyCardCount = company.card_count ?? 0;
          return (
            <tbody key={company.id}>
              <tr className="border-t border-slate-100 hover:bg-white">
                <td data-label="Company" className="p-5 font-medium">{company.company_name || company.full_name}{company.account_type === "enterprise" && <span className="ml-2 text-xs text-slate-500">Legacy Enterprise</span>}</td>
                <td data-label="Primary Contact" className="p-5 text-slate-600">{company.full_name}</td>
                <td data-label="People" className="p-5 text-slate-600">{users.length}</td>
                <td data-label="Cards" className="p-5 text-slate-600">{companyCardCount}</td>
                <td data-label="Status" className="p-5"><StatusBadge status={company.status} /></td>
                <td data-label="Manage" className="p-5">
                  <div className="flex gap-3">
                    <button onClick={(e) => { e.stopPropagation(); props.toggleCompany(company.id); }} className="text-sm text-purple-700 hover:text-purple-800">Manage</button>

                  </div>
                </td>
              </tr>

            </tbody>
          );
        })}
    </table>
    {props.managementCompanies?.filter(company => company.id === props.expandedCompany).map(company => {
      const users = props.clientUsers.filter(user => user.client_id === company.id);
      return <AdminClientSheet key={company.id} title={company.company_name || company.full_name} busy={props.busy} onClose={() => props.onCloseManagement?.()} notice={props.notice}>
        {props.error && <p role="alert" className={styles.error}>{props.error}</p>}
        <fieldset disabled={props.busy}>
                    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
                      <button disabled={props.busy} onClick={() => props.toggleClientStatus(company)}>{company.status === "suspended" ? "Reactivate Client" : "Suspend Client"}</button>
                      <div className="rounded-2xl border border-[#AC00FF]/25 bg-slate-50/60 p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <span className="rounded-full border border-[#AC00FF]/30 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">Client Admin</span>
                            <h3 className="mt-3 text-lg font-semibold">Client Admin / Main Contact</h3>
                            <p className="mt-1 text-sm text-slate-500">This is the company contact responsible for onboarding and staff data.</p>
                          </div>
                          <button type="button" onClick={() => props.openAdminContactDetails(company)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">Edit Admin Contact</button>
                        </div>
                        <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                          <AdminContactDetail label="Contact Name" value={company.full_name || "-"} />
                          <AdminContactDetail label="Email" value={company.email || "-"} emphasized />
                          <AdminContactDetail label="Phone" value={company.phone || "-"} emphasized />
                          <AdminContactDetail label="Role" value={company.job_title || "Client Admin"} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input aria-label="Full name" placeholder="Full name" value={props.staffFullName} onChange={(e) => props.setStaffFullName(e.target.value)} className={styles.input} />
                        <input aria-label="Job title" placeholder="Job title" value={props.staffJobTitle} onChange={(e) => props.setStaffJobTitle(e.target.value)} className={styles.input} />
                        <input aria-label="Email" placeholder="Email" value={props.staffEmail} onChange={(e) => props.setStaffEmail(e.target.value)} className={styles.input} />
                        <input aria-label="Phone" placeholder="Phone" value={props.staffPhone} onChange={(e) => props.setStaffPhone(e.target.value)} className={styles.input} />
                        <button onClick={() => props.createClientUser(company)} className="rounded-2xl bg-gradient-to-r from-pink-600 to-purple-700 text-white px-5 text-sm font-medium">Add User</button>
                      </div>
                      <StaffUsersTable users={users} companyId={company.id} findCardsForUser={props.findCardsForUser} openStaffDetails={props.openStaffDetails} openCardPreview={props.openCardPreview} deleteClientUser={props.deleteClientUser} />
                    </div>

        </fieldset>
      </AdminClientSheet>;
    })}
    </>
  );
}

async function parseImportFile(file: File) {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
  }
  const text = await file.text();
  const rows = text.split(/\r?\n/).map((line) => line.split(",").map((cell) => cell.trim()));
  const [headers = [], ...dataRows] = rows.filter((row) => row.some(Boolean));
  return dataRows.map((row) =>
    headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = row[index] || "";
      return record;
    }, {})
  );
}

function normalizeImportRow(row: Record<string, string>): ImportRow {
  return importHeaders.reduce((record, header) => {
    record[header] = String(row[header] || "").trim();
    return record;
  }, {} as ImportRow);
}

function StatCard({ label, value, caption, danger = false }: { label: string; value: number | string; caption: string; danger?: boolean }) {
  return <div className={styles.stat}><p>{label}</p><strong className={danger ? styles.danger : ""}>{value}</strong><small>{caption}</small></div>;

}

function FullListModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <AdminClientSheet title={title} onClose={onClose} wide>{children}</AdminClientSheet>;

}

function StaffUsersTable(props: {
  users: ClientUser[];
  companyId: string;
  findCardsForUser: (companyId: string, user: ClientUser) => Card[];
  openStaffDetails: (user: ClientUser) => void;
  openCardPreview: (cards: Card[], user: ClientUser) => void;
  deleteClientUser: (user: ClientUser) => void;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Users / Staff</h3>
          <p className="mt-1 text-sm text-slate-500">Staff users under this company account.</p>
        </div>
        <span className="rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-600">{props.users.length} users</span>
      </div>
      {props.users.length === 0 ? (
        <p className="mt-5 text-sm text-slate-500">No users added yet. Add users here or import them later.</p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <table className={styles.inventoryTable}>
            <thead className="bg-white text-left text-slate-500">
              <tr><th className="p-4">Full Name</th><th className="p-4">Job Title</th><th className="p-4">Email</th><th className="p-4">Phone</th><th className="p-4">Status</th><th className="p-4">Cards</th><th className="p-4">Card Status</th><th className="p-4">Actions</th></tr>
            </thead>
            <tbody>
              {props.users.map((user) => {
                const userCards = props.findCardsForUser(props.companyId, user);
                const cardStatus = userCards.length ? userCards.some((card) => card.is_published) ? "published" : "draft" : "unpublished";
                return (
                  <tr key={user.id} className="border-t border-slate-100">
                    <td data-label="Name" className="p-4">{user.full_name || user.name || "Unnamed user"}</td>
                    <td data-label="Job title" className="p-4 text-slate-600">{user.job_title || "-"}</td>
                    <td data-label="Email" className="p-4 text-slate-600">{user.email || "-"}</td>
                    <td data-label="Phone" className="p-4 text-slate-600">{user.phone || "-"}</td>
                    <td data-label="Status" className="p-4"><StatusBadge status={user.status || "active"} /></td>
                    <td data-label="Cards" className="p-4 text-slate-600">{userCards.length}</td>
                    <td data-label="Card status" className="p-4"><CardStatusBadge status={cardStatus} /></td>
                    <td data-label="Actions" className="p-4">
                      <button onClick={() => props.openStaffDetails(user)} className="mr-4 text-sm text-purple-700 hover:text-purple-800">View</button>
                      {userCards.length > 0 && <button onClick={() => props.openCardPreview(userCards, user)} className="mr-4 text-sm text-emerald-800 hover:text-green-200">Card Preview</button>}
                      <button onClick={() => props.deleteClientUser(user)} className="text-sm text-red-700 hover:text-red-800">Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, description, count, onViewFullList }: { title: string; description: string; count: number; onViewFullList: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 p-6">
      <div>
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-full border border-[#AC00FF]/30 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">{count} shown</span>
        <button type="button" onClick={onViewFullList} className="rounded-2xl bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600 transition hover:bg-white/15 hover:text-purple-800">{title.includes("Companies") ? "View All Companies" : "View All Clients"}</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-medium text-slate-600">{label}</span>{children}</label>;
}

function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: string[] }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={styles.input}>
      <option value="all">{label}</option>
      {options.map((option) => <option key={option} value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</option>)}
    </select>
  );
}

function ImportStatus({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 truncate text-sm font-medium text-slate-700">{value}</p></div>;
}

function AdminContactDetail({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 truncate text-sm font-medium ${emphasized ? "text-purple-700" : "text-slate-700"}`}>{value}</p></div>;
}

function UserDetailsModal({ busy, error, notice, onStatus, modal, form, editMode, onChange, onClose, onEdit, onCancel, onSave }: {
  busy: boolean;
  error: string;
  notice: string;
  onStatus: () => void;
  modal: Exclude<DetailsModal, null>;
  form: Record<string, string>;
  editMode: boolean;
  onChange: (field: string, value: string) => void;
  onClose: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const fields = modal.type === "client"
    ? [["full_name", "Full Name"], ["email", "Email"], ["phone", "Phone Number"]]
    : modal.type === "admin"
    ? [["full_name", "Contact Name"], ["email", "Email"], ["phone", "Phone"]]
    : [["company_name", "Company Name"], ["full_name", "Full Name"], ["job_title", "Job Title"], ["email", "Email"], ["phone", "Phone"], ["website", "Website"], ["address", "Address"], ["whatsapp", "WhatsApp"], ["linkedin", "LinkedIn"], ["instagram", "Instagram"], ["facebook", "Facebook"], ["youtube", "YouTube"], ["booking_link", "Booking Link"], ["custom_url", "Custom URL"], ["status", "Status"]];
  return (
    <AdminClientSheet title={modal.type === "staff" ? "Manage Staff" : "Manage Client"} busy={busy} onClose={onClose} notice={notice}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {modal.type !== "client" && <p className="mb-4 text-sm text-slate-500">Plan and billing labels are informational, not entitlement grants.</p>}
      <div className={styles.headerActions}>
        {!editMode && <button disabled={busy} className={styles.primary} onClick={onEdit}>Edit details</button>}
        {modal.type === "admin" && <button disabled={busy} onClick={onStatus}>{form.status === "suspended" ? "Reactivate Client" : "Suspend Client"}</button>}
      </div>
      <fieldset disabled={busy}>
        <div className={modal.type === "client" ? styles.clientDetails : "flex-1 overflow-y-auto p-6"}>
          <div className={modal.type === "client" ? styles.detailStack : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
            {fields.map(([field, label]) => (
              <div key={field} className={modal.type === "client" ? styles.detailRow : "rounded-2xl border border-slate-200 bg-white p-3"}>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>
                {editMode && !(modal.type === "client" && ["subscription_plan", "billing_status", "status"].includes(field)) ? <ModalEditField label={label} modalType={modal.type} field={field} value={form[field] || ""} form={form} onChange={onChange} /> : <p className="mt-3 break-words text-sm text-slate-700">{form[field] || "-"}</p>}
              </div>
            ))}
          </div>
        </div>
        {editMode && <div className="flex justify-end gap-3 border-t border-slate-200 p-5"><button disabled={busy} onClick={onCancel} className="rounded-2xl bg-slate-50 px-5 py-3 text-sm font-medium">Cancel</button><button disabled={busy} onClick={onSave} className={`rounded-2xl bg-gradient-to-r from-pink-600 to-purple-700 text-white px-5 py-3 text-sm font-medium ${modal.type === "client" ? `${styles.primary} ${styles.individualPrimary}` : ""}`}>{busy ? "Saving…" : "Save Changes"}</button></div>}
      </fieldset>
      {modal.type === "client" && <>
        <dl className={styles.clientSummary} aria-label="Client summary">
          <div><dt>Plan</dt><dd>{individualPlanLabel(modal.data.subscription_plan)}</dd></div>
          <div><dt>Cards</dt><dd>{modal.data.card_count ?? "—"}</dd></div>
          <div><dt>Status</dt><dd>{form.status || "—"}</dd></div>
        </dl>
        <p className={styles.planNote}>Plan is a display label, not an entitlement grant.</p>
      </>}
      {modal.type === "client" && <section className={styles.accountActions} aria-label="Account Actions">
        <h3>Account Actions</h3>
        <button disabled={busy} onClick={onStatus}>{form.status === "suspended" ? "Reactivate Client" : "Suspend Client"}</button>
      </section>}
    </AdminClientSheet>
  );
}

function ModalEditField({ label, modalType, field, value, form, onChange }: { label: string; modalType: "client" | "admin" | "staff"; field: string; value: string; form: Record<string, string>; onChange: (field: string, value: string) => void }) {
  const inputClass = "mt-2 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-[#AC00FF]";
  if (field === "status") {
    const options = modalType === "staff" ? ["active", "suspended"] : ["active", "pending", "suspended"];
    return <select aria-label={label} value={value} onChange={(e) => onChange(field, e.target.value)} className={inputClass}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  }
  if (modalType === "client" && field === "account_type") {
    return <select aria-label={label} value={value} onChange={(e) => onChange("account_type", e.target.value)} className={inputClass}><option value="individual">individual</option><option value="business">business</option>{value === "enterprise" && <option value="enterprise" disabled>enterprise (legacy)</option>}</select>;
  }
  if (modalType === "client" && field === "subscription_plan") {
    const isIndividual = form.account_type === "individual";
    return <select aria-label={label} value={isIndividual ? value : "paid"} disabled={!isIndividual} onChange={(e) => { onChange("subscription_plan", e.target.value); onChange("billing_status", e.target.value === "free" ? "free" : "paid"); }} className={inputClass}>{isIndividual ? <><option value="free">free</option><option value="paid">paid</option></> : <option value="paid">paid</option>}</select>;
  }
  if (modalType === "client" && field === "billing_status") {
    const controlled = form.account_type === "individual" && form.subscription_plan === "free" ? "free" : "paid";
    return <select aria-label={label} value={controlled} disabled className={inputClass}><option value="free">free</option><option value="paid">paid</option></select>;
  }
  return <input aria-label={label} value={value} onChange={(e) => onChange(field, e.target.value)} className={inputClass} />;
}

function TableMessage({ message }: { message: string }) {
  return <tr><td colSpan={6} className="p-5 text-slate-500">{message}</td></tr>;
}

function PublishedCardPreviewModal({ cards, user, currentIndex, templates, onPrevious, onNext, onClose, onDeleteCard }: {
  cards: Card[];
  user: ClientUser | null;
  currentIndex: number;
  templates: Template[];
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onDeleteCard: (card: Card) => void;
}) {
  const card = cards[currentIndex];
  const template = templates.find((item) => item.id === card.template_id) || null;
  const data = user ? { ...card, full_name: user.full_name || user.name || card.full_name, job_title: user.job_title || card.job_title, email: user.email || card.email, phone: user.phone || card.phone, website: user.website || card.website, address: user.address || card.address, whatsapp: user.whatsapp || card.whatsapp, linkedin: user.linkedin || card.linkedin, instagram: user.instagram || card.instagram, facebook: user.facebook || card.facebook, youtube: user.youtube || card.youtube, booking_link: user.booking_link || card.booking_link, custom_url: user.custom_url || card.custom_url } : card;
  return (
    <AdminClientSheet title="Card Preview" onClose={onClose}>
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 p-6">
          <div><h2 className="text-2xl font-semibold">Card Preview</h2><p className="mt-1 text-sm text-slate-500">{card.card_name || card.name || "Digital card"} · {template?.name || "Template unavailable"}</p></div>
          <div className="flex items-center gap-3">
            {cards.length > 1 && <><button onClick={onPrevious} className="rounded-2xl bg-slate-50 px-4 py-2.5 text-sm">←</button><span className="rounded-full border border-[#AC00FF]/30 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">Card {currentIndex + 1} of {cards.length}</span><button onClick={onNext} className="rounded-2xl bg-slate-50 px-4 py-2.5 text-sm">→</button></>}
            <button onClick={() => onDeleteCard(card)} className="rounded-2xl bg-red-50 px-5 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-500/25">Delete Card</button>
            <button onClick={onClose} className="rounded-2xl bg-slate-50 px-5 py-2.5 text-sm font-medium">Close</button>
          </div>
        </div>
        <div className="max-h-[calc(85vh-104px)] overflow-y-auto p-6">
          <p className="mb-4 text-center text-xs text-slate-500">
            Admin deletion is for support and enterprise management only.
          </p>
          {template ? (
            <div className={`mx-auto max-w-md ${styles.mediaPreview}`}><CardRenderer mode="preview" showActions={template.supports_save_contact ?? true} template={template} cardData={data} /></div>
          ) : (
            <div className="mx-auto max-w-md rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm leading-6 text-slate-600">
              This card references a template that is not currently published.
            </div>
          )}
        </div>
    </AdminClientSheet>
  );
}

function ClientActions({ client, onView }: { client: Client; onView: (client: Client) => void; onToggle: (client: Client) => void }) {
  return <button className={styles.manage} onClick={() => onView(client)} aria-label={`Manage ${client.full_name}`}>Manage →</button>;
}

function StatusBadge({ status }: { status: string }) {
  const styles = status === "active" ? "bg-emerald-50 text-emerald-800" : status === "pending" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700";
  return <span className={`rounded-full px-3 py-1 text-xs capitalize ${styles}`}>{status}</span>;
}

function CardStatusBadge({ status }: { status: string }) {
  const styles = status === "published" ? "bg-emerald-50 text-emerald-800" : status === "draft" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-500";
  return <span className={`rounded-full px-3 py-1 text-xs capitalize ${styles}`}>{status}</span>;
}
