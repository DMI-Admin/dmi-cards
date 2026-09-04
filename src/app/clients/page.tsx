"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import CardRenderer from "@/components/CardRenderer";
import { supabase } from "@/lib/supabase";
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
  cards_active: number | null;
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

const fallbackTemplate: Template = {
  id: "fallback",
  name: "Digital Card",
  layout_type: "classic",
  logo_size: "standard",
  access_level: "premium",
  requires_profile_image: true,
  requires_logo: true,
  supports_bio: true,
  supports_save_contact: true,
  allowed_fields: ["phone", "email", "website", "address"],
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientUsers, setClientUsers] = useState<ClientUser[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [fullListMode, setFullListMode] = useState<"individual" | "business" | null>(null);

  const [individualSearch, setIndividualSearch] = useState("");
  const [individualPlanFilter, setIndividualPlanFilter] = useState("all");
  const [individualBillingFilter, setIndividualBillingFilter] = useState("all");
  const [individualStatusFilter, setIndividualStatusFilter] = useState("all");
  const [businessSearch, setBusinessSearch] = useState("");
  const [businessTypeFilter, setBusinessTypeFilter] = useState("all");
  const [businessPlanFilter, setBusinessPlanFilter] = useState("all");
  const [businessBillingFilter, setBusinessBillingFilter] = useState("all");
  const [businessStatusFilter, setBusinessStatusFilter] = useState("all");

  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [accountType, setAccountType] = useState("individual");
  const [subscriptionPlan, setSubscriptionPlan] = useState("free");
  const [billingStatus, setBillingStatus] = useState("free");
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
    const [clientsResult, usersResult, cardsResult, templatesResult] =
      await Promise.all([
        supabase.from("clients").select("*").order("created_at", { ascending: false }),
        supabase.from("client_users").select("*"),
        supabase.from("cards").select("*").order("created_at", { ascending: false }),
        supabase.from("templates").select("*"),
      ]);

    if (clientsResult.error) console.error(clientsResult.error.message);
    if (usersResult.error) setClientUsers([]);
    else if (usersResult.data) setClientUsers(usersResult.data);
    if (cardsResult.error) setCards([]);
    else if (cardsResult.data) setCards(cardsResult.data);
    if (templatesResult.error) setTemplates([]);
    else if (templatesResult.data) setTemplates(templatesResult.data);
    if (clientsResult.data) setClients(clientsResult.data);
    setLoading(false);
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

  function applyAccountType(value: string) {
    setAccountType(value);
    // Future billing automation rules:
    // Business/Enterprise: paid = paid on time, overdue = missed payment,
    // suspended = missed over one month.
    // Individual Paid: Stripe direct debit failure should eventually suspend
    // the account automatically.
    if (value === "individual") {
      setSubscriptionPlan("free");
      setBillingStatus("free");
      return;
    }
    setSubscriptionPlan("paid");
    setBillingStatus("paid");
  }

  function applySubscriptionPlan(value: string) {
    setSubscriptionPlan(value);
    setBillingStatus(value === "free" ? "free" : "paid");
  }

  async function createClientRecord() {
    if (accountType === "individual" && (!fullName || !email)) return;
    if (accountType !== "individual" && (!companyName || !email)) return;
    const { error } = await supabase.from("clients").insert([
      {
        full_name: fullName || companyName,
        company_name: companyName,
        email,
        phone,
        account_type: accountType,
        subscription_plan: subscriptionPlan,
        billing_status: billingStatus,
        status: clientStatus,
        cards_active: 0,
      },
    ]);
    if (error) return alert(error.message);
    setFullName("");
    setCompanyName("");
    setEmail("");
    setPhone("");
    void fetchClientData();
  }

  async function toggleClientStatus(client: Client) {
    const nextStatus = client.status === "suspended" ? "active" : "suspended";
    const actionLabel = nextStatus === "suspended" ? "Suspend" : "Reactivate";
    const clientLabel =
      client.company_name || client.full_name || client.email || "this client";
    const confirmed = window.confirm(
      nextStatus === "suspended"
        ? `${actionLabel} ${clientLabel}? The client will lose access to the Client Portal, but their cards, contacts, profile, billing records, Wallet passes, and account data will remain intact.`
        : `${actionLabel} ${clientLabel}? This restores Client Portal access using the existing account data.`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("clients")
      .update({ status: nextStatus })
      .eq("id", client.id);
    if (error) return alert(error.message);

    const { error: usersError } = await supabase
      .from("client_users")
      .update({ status: nextStatus })
      .eq("client_id", client.id);

    if (usersError) return alert(usersError.message);

    void fetchClientData();
  }

  async function createClientUser(client: Client) {
    if (!staffFullName || !staffEmail) return;
    const { error } = await supabase.from("client_users").insert([
      {
        client_id: client.id,
        full_name: staffFullName,
        job_title: staffJobTitle,
        email: staffEmail,
        phone: staffPhone,
        status: "active",
      },
    ]);
    if (error) return alert(error.message);
    setStaffFullName("");
    setStaffJobTitle("");
    setStaffEmail("");
    setStaffPhone("");
    void fetchClientData();
  }

  async function deleteClientUser(user: ClientUser) {
    if (!window.confirm(`Delete user ${user.full_name || user.name}?`)) return;
    const { error } = await supabase.from("client_users").delete().eq("id", user.id);
    if (error) return alert(error.message);
    void fetchClientData();
  }

  async function deleteCard(card: Card) {
    const confirmed = window.confirm(
      "Delete this card permanently? This may affect the client’s card limit and public card URL."
    );

    if (!confirmed) return;

    const { error } = await supabase.from("cards").delete().eq("id", card.id);

    if (error) return alert(error.message);

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
      cards_active: String(client.cards_active ?? 0),
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
    if (!detailsForm.full_name?.trim()) return alert("Full name is required.");
    if ((detailsModal.type === "client" || detailsModal.type === "admin") && !detailsForm.email?.trim()) {
      return alert("Email is required.");
    }

    if (detailsModal.type === "client") {
      const nextSubscriptionPlan =
        detailsForm.account_type === "individual" ? detailsForm.subscription_plan : "paid";
      const nextBillingStatus =
        detailsForm.account_type === "individual" && nextSubscriptionPlan === "free" ? "free" : "paid";
      const { error } = await supabase
        .from("clients")
        .update({
          full_name: detailsForm.full_name,
          company_name: detailsForm.company_name,
          email: detailsForm.email,
          phone: detailsForm.phone,
          account_type: detailsForm.account_type,
          subscription_plan: nextSubscriptionPlan,
          billing_status: nextBillingStatus,
          status: detailsForm.status,
          cards_active: Number(detailsForm.cards_active || 0),
        })
        .eq("id", detailsModal.data.id);
      if (error) return alert(error.message);
    } else if (detailsModal.type === "admin") {
      const { error } = await supabase
        .from("clients")
        .update({
          full_name: detailsForm.full_name,
          email: detailsForm.email,
          phone: detailsForm.phone,
        })
        .eq("id", detailsModal.data.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase
        .from("client_users")
        .update({
          full_name: detailsForm.full_name,
          job_title: detailsForm.job_title,
          email: detailsForm.email,
          phone: detailsForm.phone,
          website: detailsForm.website,
          address: detailsForm.address,
          whatsapp: detailsForm.whatsapp,
          linkedin: detailsForm.linkedin,
          instagram: detailsForm.instagram,
          facebook: detailsForm.facebook,
          youtube: detailsForm.youtube,
          booking_link: detailsForm.booking_link,
          custom_url: detailsForm.custom_url,
          status: detailsForm.status,
        })
        .eq("id", detailsModal.data.id);
      if (error) return alert(error.message);
    }

    await fetchClientData();
    closeDetailsModal();
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
    const rows = await parseImportFile(file);
    setImportFileName(file.name);
    setImportRowCount(rows.length);
    setImportRows(rows.map(normalizeImportRow));
    setReviewImport(true);
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
    setImportingFile(true);
    try {
      const companies = new Map<string, ImportRow[]>();
      importRows.forEach((row) => {
        if (!row.company_name.trim()) return;
        companies.set(row.company_name, [...(companies.get(row.company_name) || []), row]);
      });
      let importedCompanies = 0;
      let importedUsers = 0;
      for (const [company, rows] of companies.entries()) {
        const first = rows[0];
        const { data, error } = await supabase
          .from("clients")
          .insert([
            {
              full_name: first.full_name || company,
              company_name: company,
              email: first.email || `${slugify(company)}-${Date.now()}@dmi.local`,
              phone: first.phone || "",
              account_type: accountType === "individual" ? "business" : accountType,
              subscription_plan: "paid",
              billing_status: "paid",
              status: clientStatus,
              cards_active: 0,
            },
          ])
          .select("id")
          .single();
        if (error || !data) {
          alert(error?.message || `Could not import ${company}`);
          continue;
        }
        importedCompanies += 1;
        const users = rows
          .filter((row) => row.full_name.trim())
          .map((row) => ({
            client_id: data.id,
            full_name: row.full_name,
            job_title: row.job_title,
            email: row.email,
            phone: row.phone,
            website: row.website,
            address: row.address,
            whatsapp: row.whatsapp,
            linkedin: row.linkedin,
            instagram: row.instagram,
            facebook: row.facebook,
            youtube: row.youtube,
            booking_link: row.booking_link,
            custom_url: row.custom_url,
            status: "active",
          }));
        if (users.length) {
          const { error: usersError } = await supabase.from("client_users").insert(users);
          if (usersError) alert(usersError.message);
          else importedUsers += users.length;
        }
      }
      await fetchClientData();
      alert(`Imported ${importedCompanies} companies and ${importedUsers} users.`);
      cancelImport();
    } finally {
      setImportingFile(false);
    }
  }

  function toggleCompany(clientId: string) {
    setExpandedCompany((current) => (current === clientId ? null : clientId));
    setStaffFullName("");
    setStaffJobTitle("");
    setStaffEmail("");
    setStaffPhone("");
  }

  function findCardsForUser(companyId: string, user: ClientUser) {
    const companyCards = cards.filter((card) => card.client_id === companyId);
    const userEmail = user.email?.trim().toLowerCase();
    const userName = (user.full_name || user.name || "").trim().toLowerCase();
    if (userEmail) {
      const matches = companyCards.filter((card) => card.email?.trim().toLowerCase() === userEmail);
      if (matches.length) return matches;
    }
    if (!userName) return [];
    return companyCards.filter((card) => card.full_name?.trim().toLowerCase() === userName);
  }

  function openCardPreview(userCards: Card[], user: ClientUser) {
    setPreviewCards(userCards);
    setPreviewUserId(user.id);
    setPreviewCardIndex(0);
  }

  const individualClients = useMemo(
    () => clients.filter((client) => client.account_type === "individual"),
    [clients]
  );
  const businessClients = useMemo(
    () =>
      clients.filter(
        (client) => client.account_type === "business" || client.account_type === "enterprise"
      ),
    [clients]
  );
  const filteredIndividualClients = useMemo(() => {
    return individualClients.filter((client) => {
      const search = individualSearch.toLowerCase();
      return (
        (client.full_name.toLowerCase().includes(search) ||
          client.email.toLowerCase().includes(search) ||
          (client.company_name || "").toLowerCase().includes(search)) &&
        (individualPlanFilter === "all" || client.subscription_plan === individualPlanFilter) &&
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
        company.toLowerCase().includes(search) &&
        (businessTypeFilter === "all" || client.account_type === businessTypeFilter) &&
        (businessPlanFilter === "all" || client.subscription_plan === businessPlanFilter) &&
        (businessBillingFilter === "all" || client.billing_status === businessBillingFilter) &&
        (businessStatusFilter === "all" || client.status === businessStatusFilter)
      );
    });
  }, [businessClients, businessSearch, businessTypeFilter, businessPlanFilter, businessBillingFilter, businessStatusFilter]);

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

  const totalClients = clients.length;
  const totalUsers = individualClients.length + clientUsers.length;
  const paidClients = clients.filter((client) => client.billing_status === "paid").length;
  const freeUsers = individualClients.filter(
    (client) => client.subscription_plan === "free" || client.billing_status === "free"
  ).length;
  const overdueClients = clients.filter((client) => client.billing_status === "overdue").length;
  const businessAccounts = businessClients.filter((client) => client.account_type === "business").length;
  const enterpriseAccounts = businessClients.filter((client) => client.account_type === "enterprise").length;
  const latestPreviewUser = previewUserId
    ? clientUsers.find((user) => user.id === previewUserId) || null
    : null;
  const latestPreviewCards = previewCards.map(
    (previewCard) => cards.find((card) => card.id === previewCard.id) || previewCard
  );

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />
      <section className="flex-1 p-10">
        <div className="mb-10">
          <h1 className="text-4xl font-bold">Client Onboarding</h1>
          <p className="mt-3 max-w-4xl text-white/50">
            Manage individual users, company accounts, staff onboarding, imports,
            plans, billing status, and card usage.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Clients" value={totalClients} caption="All account records" />
          <StatCard label="Total Users" value={totalUsers} caption="People across all accounts" />
          <StatCard label="Free Users" value={freeUsers} caption="Individual free access" />
          <StatCard label="Paid Users" value={paidClients} caption="Current billing" />
          <StatCard label="Individual Users" value={individualClients.length} caption="Personal client accounts" />
          <StatCard label="Business Accounts" value={businessAccounts} caption="Company workspaces" />
          <StatCard label="Enterprise Accounts" value={enterpriseAccounts} caption="Enterprise workspaces" />
          <StatCard label="Overdue" value={overdueClients} caption="Needs attention" danger />
        </div>

        <AddClientSection
          fullName={fullName}
          setFullName={setFullName}
          companyName={companyName}
          setCompanyName={setCompanyName}
          email={email}
          setEmail={setEmail}
          phone={phone}
          setPhone={setPhone}
          accountType={accountType}
          applyAccountType={applyAccountType}
          subscriptionPlan={subscriptionPlan}
          applySubscriptionPlan={applySubscriptionPlan}
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

        <ClientSection
          title="Individual Clients"
          description="Individual accounts are shown as people."
          count={filteredIndividualClients.length}
          onViewFullList={() => setFullListMode("individual")}
          filters={
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
          }
        >
          <IndividualTable
            loading={loading}
            clients={filteredIndividualClients}
            openClientDetails={openClientDetails}
            toggleClientStatus={toggleClientStatus}
          />
        </ClientSection>

        <ClientSection
          title="Business & Enterprise Clients"
          description="Each row is a company account from clients. Staff users live in client_users."
          count={filteredBusinessClients.length}
          onViewFullList={() => setFullListMode("business")}
          filters={
            <BusinessFilters
              search={businessSearch}
              setSearch={setBusinessSearch}
              type={businessTypeFilter}
              setType={setBusinessTypeFilter}
              plan={businessPlanFilter}
              setPlan={setBusinessPlanFilter}
              billing={businessBillingFilter}
              setBilling={setBusinessBillingFilter}
              status={businessStatusFilter}
              setStatus={setBusinessStatusFilter}
            />
          }
        >
          <BusinessTable
            loading={loading}
            companies={filteredBusinessClients}
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
        </ClientSection>
      </section>

      {fullListMode && (
        <FullListModal
          title={fullListMode === "individual" ? "Individual Clients" : "Business & Enterprise Clients"}
          onClose={() => setFullListMode(null)}
        >
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
                  clients={filteredIndividualClients}
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
                type={businessTypeFilter}
                setType={setBusinessTypeFilter}
                plan={businessPlanFilter}
                setPlan={setBusinessPlanFilter}
                billing={businessBillingFilter}
                setBilling={setBusinessBillingFilter}
                status={businessStatusFilter}
                setStatus={setBusinessStatusFilter}
              />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <BusinessTable
                  loading={loading}
                  companies={filteredBusinessClients}
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
        </FullListModal>
      )}

      {detailsModal && (
        <UserDetailsModal
          modal={detailsModal}
          form={detailsForm}
          editMode={detailsEditMode}
          onChange={(field, value) => setDetailsForm((current) => ({ ...current, [field]: value }))}
          onClose={closeDetailsModal}
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
  fullName: string;
  setFullName: (value: string) => void;
  companyName: string;
  setCompanyName: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  phone: string;
  setPhone: (value: string) => void;
  accountType: string;
  applyAccountType: (value: string) => void;
  subscriptionPlan: string;
  applySubscriptionPlan: (value: string) => void;
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
    <div className="mb-8 rounded-3xl border border-white/10 bg-white/5 p-7">
      <h2 className="text-2xl font-semibold">Add Client / Company</h2>
      <p className="mt-2 text-sm leading-6 text-white/45">
        Create one individual person account, or one business/enterprise company account.
      </p>
      <div className="mt-7 grid grid-cols-4 gap-x-4 gap-y-5">
        <Field label="Full Name / Primary Contact">
          <input value={props.fullName} onChange={(e) => props.setFullName(e.target.value)} className="inputStyle" />
        </Field>
        <Field label="Company Name">
          <input value={props.companyName} onChange={(e) => props.setCompanyName(e.target.value)} className="inputStyle" />
        </Field>
        <Field label="Email Address">
          <input value={props.email} onChange={(e) => props.setEmail(e.target.value)} className="inputStyle" />
        </Field>
        <Field label="Phone Number">
          <input value={props.phone} onChange={(e) => props.setPhone(e.target.value)} className="inputStyle" />
        </Field>
        <Field label="Account Type">
          <select value={props.accountType} onChange={(e) => props.applyAccountType(e.target.value)} className="inputStyle">
            <option value="individual">Individual</option>
            <option value="business">Business</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </Field>
        <Field label="Subscription">
          <select
            value={props.subscriptionPlan}
            onChange={(e) => props.applySubscriptionPlan(e.target.value)}
            disabled={props.accountType !== "individual"}
            className="inputStyle"
          >
            {props.accountType === "individual" ? (
              <>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </>
            ) : (
              <option value="paid">Paid</option>
            )}
          </select>
          <span className="mt-2 block text-xs text-white/35">
            Billing status is system-controlled and will later sync from Finance/Stripe.
          </span>
        </Field>
        <Field label="Client Status">
          <select value={props.clientStatus} onChange={(e) => props.setClientStatus(e.target.value)} className="inputStyle">
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>
      </div>
      <button onClick={props.createClientRecord} className="mt-7 rounded-2xl bg-[#AC00FF] px-6 py-3 font-medium transition hover:opacity-90">
        Create Account
      </button>

      <div className="mt-8 rounded-3xl border border-white/10 bg-[#101935]/60 p-6 shadow-2xl shadow-[#AC00FF]/5">
        <div className="grid gap-6 xl:grid-cols-[1fr_520px]">
          <div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-100 ring-1 ring-[#AC00FF]/30">
              <FileSpreadsheet size={22} />
            </div>
            <h3 className="mt-4 text-2xl font-semibold">Bulk Company Import</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">
              Supports Microsoft Excel and CSV uploads. Billing, plan, and account type are controlled by the admin form above.
            </p>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={props.downloadExcelTemplate} className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-5 text-sm font-medium transition hover:bg-white/15">
                <Download size={18} />
                Download Template
              </button>
              <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6D4BFF] px-5 text-sm font-medium">
                <UploadCloud size={18} />
                {props.importingFile ? "Importing..." : "Upload Company File"}
                <input type="file" accept=".csv,.xlsx,.xls" disabled={props.importingFile} className="hidden" onChange={(e) => {
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
      </div>

      {props.reviewImport && (
        <div className="mt-8 rounded-3xl border border-[#AC00FF]/25 bg-[#070B1A]/55 p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h3 className="text-2xl font-semibold">Review Import</h3>
              <p className="mt-2 text-sm text-white/45">Review and edit staff users before anything is saved.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={props.cancelImport} className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-medium">Cancel Import</button>
              <button onClick={props.confirmImport} className="rounded-2xl bg-[#AC00FF] px-5 py-3 text-sm font-medium">Confirm Import</button>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
            {props.importCompanies.map((company) => (
              <div key={company.company} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/35">Company name</p>
                <p className="mt-1 font-medium">{company.company}</p>
                <p className="mt-3 text-xs text-white/35">First staff user</p>
                <p className="mt-1 text-sm text-white/70">{company.primaryContact}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-[1900px] w-full text-sm">
              <thead className="bg-white/5 text-left text-white/45">
                <tr>{importHeaders.map((header) => <th key={header} className="p-3 capitalize">{header.replace("_", " ")}</th>)}</tr>
              </thead>
              <tbody>
                {props.importRows.map((row, index) => (
                  <tr key={`${row.company_name}-${row.email}-${index}`} className="border-t border-white/5">
                    {(importHeaders as (keyof ImportRow)[]).map((field) => (
                      <td key={field} className="p-2">
                        <input value={row[field] || ""} onChange={(e) => props.updateImportRow(index, field, e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-[#101935] px-3 text-sm outline-none focus:border-[#AC00FF]" />
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
    <div className="mb-8 rounded-3xl border border-white/10 bg-white/5">
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
    <div className="border-b border-white/10 p-6">
      <div className="grid grid-cols-4 gap-4">
        <input placeholder="Search people, company or email" value={props.search} onChange={(e) => props.setSearch(e.target.value)} className="inputStyle" />
        <FilterSelect value={props.plan} onChange={props.setPlan} label="All Subscriptions" options={["free", "paid"]} />
        <FilterSelect value={props.billing} onChange={props.setBilling} label="All Billing" options={["paid", "trial", "overdue", "cancelled"]} />
        <FilterSelect value={props.status} onChange={props.setStatus} label="All Statuses" options={["active", "pending", "suspended"]} />
      </div>
      <p className="mt-3 text-xs text-white/35">Billing status will later sync from Finance/Stripe.</p>
    </div>
  );
}

function BusinessFilters(props: {
  search: string;
  setSearch: (value: string) => void;
  type: string;
  setType: (value: string) => void;
  plan: string;
  setPlan: (value: string) => void;
  billing: string;
  setBilling: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
}) {
  return (
    <div className="border-b border-white/10 p-6">
      <div className="grid grid-cols-5 gap-4">
        <input placeholder="Search company names" value={props.search} onChange={(e) => props.setSearch(e.target.value)} className="inputStyle" />
        <FilterSelect value={props.type} onChange={props.setType} label="All Types" options={["business", "enterprise"]} />
        <FilterSelect value={props.plan} onChange={props.setPlan} label="All Subscriptions" options={["paid"]} />
        <FilterSelect value={props.billing} onChange={props.setBilling} label="All Billing" options={["paid", "trial", "overdue", "cancelled"]} />
        <FilterSelect value={props.status} onChange={props.setStatus} label="All Statuses" options={["active", "pending", "suspended"]} />
      </div>
      <p className="mt-3 text-xs text-white/35">Billing status will later sync from Finance/Stripe.</p>
    </div>
  );
}

function IndividualTable(props: {
  loading: boolean;
  clients: Client[];
  openClientDetails: (client: Client) => void;
  toggleClientStatus: (client: Client) => void;
}) {
  return (
    <table className="w-full">
      <thead className="sticky top-0 z-30 border-b border-white/10 bg-[#101935]">
        <tr className="text-left text-white/60">
          <th className="p-5">Client</th><th className="p-5">Company</th><th className="p-5">Email</th><th className="p-5">Plan</th><th className="p-5">Billing</th><th className="p-5">Cards</th><th className="p-5">Status</th><th className="p-5">Actions</th>
        </tr>
      </thead>
      <tbody>
        {props.loading ? <TableMessage message="Loading individual clients..." /> : props.clients.length === 0 ? <TableMessage message="No matching individual clients found." /> : props.clients.map((client) => (
          <tr key={client.id} className="border-t border-white/5 hover:bg-white/5">
            <td className="p-5 font-medium">{client.full_name}</td>
            <td className="p-5 text-white/70">{client.company_name || "-"}</td>
            <td className="p-5 text-white/70">{client.email}</td>
            <td className="p-5 capitalize text-white/70">{client.subscription_plan}</td>
            <td className="p-5"><BillingBadge status={client.billing_status || "paid"} /></td>
            <td className="p-5 text-white/70">{client.cards_active ?? 0}</td>
            <td className="p-5"><StatusBadge status={client.status} /></td>
            <td className="p-5"><ClientActions client={client} onView={props.openClientDetails} onToggle={props.toggleClientStatus} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BusinessTable(props: {
  loading: boolean;
  companies: Client[];
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
    <table className="w-full">
      <thead className="sticky top-0 z-30 border-b border-white/10 bg-[#101935]">
        <tr className="text-left text-white/60">
          <th className="p-5">Company</th><th className="p-5">Account Type</th><th className="p-5">Plan</th><th className="p-5">Billing</th><th className="p-5">Total Users</th><th className="p-5">Cards</th><th className="p-5">Status</th><th className="p-5">Actions</th>
        </tr>
      </thead>
      <tbody>
        {props.loading ? <TableMessage message="Loading company accounts..." /> : props.companies.length === 0 ? <TableMessage message="No matching company accounts found." /> : props.companies.map((company) => {
          const users = props.clientUsers.filter((user) => user.client_id === company.id);
          const companyCardCount = props.cards.filter((card) => card.client_id === company.id).length;
          const expanded = props.expandedCompany === company.id;
          return (
            <Fragment key={company.id}>
              <tr onClick={() => props.toggleCompany(company.id)} className="cursor-pointer border-t border-white/5 hover:bg-white/5">
                <td className="p-5 font-medium">{company.company_name || company.full_name}</td>
                <td className="p-5 capitalize text-white/70">{company.account_type}</td>
                <td className="p-5 capitalize text-white/70">{company.subscription_plan}</td>
                <td className="p-5"><BillingBadge status={company.billing_status || "paid"} /></td>
                <td className="p-5 text-white/70">{users.length}</td>
                <td className="p-5 text-white/70">{companyCardCount}</td>
                <td className="p-5"><StatusBadge status={company.status} /></td>
                <td className="p-5">
                  <div className="flex gap-3">
                    <button onClick={(e) => { e.stopPropagation(); props.toggleCompany(company.id); }} className="text-sm text-blue-300 hover:text-blue-200">View</button>
                    <button onClick={(e) => { e.stopPropagation(); props.toggleClientStatus(company); }} className="text-sm text-yellow-300 hover:text-yellow-200">{company.status === "suspended" ? "Reactivate Client" : "Suspend Client"}</button>
                  </div>
                </td>
              </tr>
              {expanded && (
                <tr className="border-t border-white/5 bg-[#101935]/50">
                  <td colSpan={8} className="p-5">
                    <div className="space-y-5 rounded-2xl border border-white/10 bg-white/5 p-5">
                      <div className="rounded-2xl border border-[#AC00FF]/25 bg-[#070B1A]/60 p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-medium text-purple-100">Client Admin</span>
                            <h3 className="mt-3 text-lg font-semibold">Client Admin / Main Contact</h3>
                            <p className="mt-1 text-sm text-white/45">This is the company contact responsible for onboarding and staff data.</p>
                          </div>
                          <button type="button" onClick={() => props.openAdminContactDetails(company)} className="rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white/80">Edit Admin Contact</button>
                        </div>
                        <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                          <AdminContactDetail label="Contact Name" value={company.full_name || "-"} />
                          <AdminContactDetail label="Email" value={company.email || "-"} emphasized />
                          <AdminContactDetail label="Phone" value={company.phone || "-"} emphasized />
                          <AdminContactDetail label="Role" value={company.job_title || "Client Admin"} />
                        </div>
                      </div>
                      <div className="grid grid-cols-5 gap-3">
                        <input placeholder="Full name" value={props.staffFullName} onChange={(e) => props.setStaffFullName(e.target.value)} className="inputStyle" />
                        <input placeholder="Job title" value={props.staffJobTitle} onChange={(e) => props.setStaffJobTitle(e.target.value)} className="inputStyle" />
                        <input placeholder="Email" value={props.staffEmail} onChange={(e) => props.setStaffEmail(e.target.value)} className="inputStyle" />
                        <input placeholder="Phone" value={props.staffPhone} onChange={(e) => props.setStaffPhone(e.target.value)} className="inputStyle" />
                        <button onClick={() => props.createClientUser(company)} className="rounded-2xl bg-[#AC00FF] px-5 text-sm font-medium">Add User</button>
                      </div>
                      <StaffUsersTable users={users} companyId={company.id} findCardsForUser={props.findCardsForUser} openStaffDetails={props.openStaffDetails} openCardPreview={props.openCardPreview} deleteClientUser={props.deleteClientUser} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
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

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function StatCard({ label, value, caption, danger = false }: { label: string; value: number; caption: string; danger?: boolean }) {
  return (
    <div className={`flex min-h-40 flex-col justify-between rounded-3xl border p-6 shadow-2xl ${danger ? "border-red-400/20 bg-red-500/10 shadow-red-500/5" : "border-white/10 bg-white/5 shadow-[#AC00FF]/5"}`}>
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/35">{label}</p>
        <p className="mt-3 text-sm leading-5 text-white/45">{caption}</p>
      </div>
      <p className={`mt-7 text-5xl font-semibold ${danger ? "text-red-300" : "text-white"}`}>{value}</p>
    </div>
  );
}

function FullListModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6">
      <div className="flex h-[85vh] max-h-[85vh] w-[92vw] max-w-7xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0F0E38] text-white shadow-2xl shadow-[#AC00FF]/20">
        <div className="shrink-0 flex items-center justify-between border-b border-white/10 p-6">
          <div>
            <h2 className="text-2xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-white/45">Full list view with search, filters, sticky headers, and actions.</p>
          </div>
          <button onClick={onClose} className="rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-medium">Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
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
          <p className="mt-1 text-sm text-white/45">Staff users under this company account.</p>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/55">{props.users.length} users</span>
      </div>
      {props.users.length === 0 ? (
        <p className="mt-5 text-sm text-white/45">No users added yet. Add users here or import them later.</p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-white/45">
              <tr><th className="p-4">Full Name</th><th className="p-4">Job Title</th><th className="p-4">Email</th><th className="p-4">Phone</th><th className="p-4">Status</th><th className="p-4">Cards</th><th className="p-4">Card Status</th><th className="p-4">Actions</th></tr>
            </thead>
            <tbody>
              {props.users.map((user) => {
                const userCards = props.findCardsForUser(props.companyId, user);
                const cardStatus = userCards.length ? userCards.some((card) => card.is_published) ? "published" : "draft" : "unpublished";
                return (
                  <tr key={user.id} className="border-t border-white/5">
                    <td className="p-4">{user.full_name || user.name || "Unnamed user"}</td>
                    <td className="p-4 text-white/60">{user.job_title || "-"}</td>
                    <td className="p-4 text-white/60">{user.email || "-"}</td>
                    <td className="p-4 text-white/60">{user.phone || "-"}</td>
                    <td className="p-4"><StatusBadge status={user.status || "active"} /></td>
                    <td className="p-4 text-white/60">{userCards.length}</td>
                    <td className="p-4"><CardStatusBadge status={cardStatus} /></td>
                    <td className="p-4">
                      <button onClick={() => props.openStaffDetails(user)} className="mr-4 text-sm text-blue-300 hover:text-blue-200">View</button>
                      {userCards.length > 0 && <button onClick={() => props.openCardPreview(userCards, user)} className="mr-4 text-sm text-green-300 hover:text-green-200">Card Preview</button>}
                      <button onClick={() => props.deleteClientUser(user)} className="text-sm text-red-300 hover:text-red-200">Delete</button>
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
    <div className="flex items-center justify-between border-b border-white/10 p-6">
      <div>
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-white/45">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-medium text-purple-100">{count} shown</span>
        <button type="button" onClick={onViewFullList} className="rounded-2xl bg-white/10 px-4 py-2 text-xs font-medium text-white/70 transition hover:bg-white/15 hover:text-white">View Full List</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-medium text-white/55">{label}</span>{children}</label>;
}

function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: string[] }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="inputStyle">
      <option value="all">{label}</option>
      {options.map((option) => <option key={option} value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</option>)}
    </select>
  );
}

function ImportStatus({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><p className="text-xs text-white/35">{label}</p><p className="mt-1 truncate text-sm font-medium text-white/80">{value}</p></div>;
}

function AdminContactDetail({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><p className="text-xs text-white/35">{label}</p><p className={`mt-1 truncate text-sm font-medium ${emphasized ? "text-purple-100" : "text-white/80"}`}>{value}</p></div>;
}

function UserDetailsModal({ modal, form, editMode, onChange, onClose, onEdit, onCancel, onSave }: {
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
    ? [["full_name", "Full Name"], ["company_name", "Company Name"], ["email", "Email"], ["phone", "Phone"], ["account_type", "Account Type"], ["subscription_plan", "Subscription"], ["billing_status", "Billing Status"], ["status", "Status"], ["cards_active", "Cards Active"]]
    : modal.type === "admin"
    ? [["full_name", "Contact Name"], ["email", "Email"], ["phone", "Phone"]]
    : [["company_name", "Company Name"], ["full_name", "Full Name"], ["job_title", "Job Title"], ["email", "Email"], ["phone", "Phone"], ["website", "Website"], ["address", "Address"], ["whatsapp", "WhatsApp"], ["linkedin", "LinkedIn"], ["instagram", "Instagram"], ["facebook", "Facebook"], ["youtube", "YouTube"], ["booking_link", "Booking Link"], ["custom_url", "Custom URL"], ["status", "Status"]];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0F0E38] text-white shadow-2xl shadow-[#AC00FF]/20">
        <div className="flex items-start justify-between gap-6 border-b border-white/10 p-6">
          <div><h2 className="text-2xl font-semibold">User Details</h2><p className="mt-1 text-sm text-white/45">Billing status will later sync from Finance/Stripe.</p></div>
          <div className="flex gap-3">{!editMode && <button onClick={onEdit} className="rounded-2xl bg-[#AC00FF] px-5 py-2.5 text-sm font-medium">Edit</button>}<button onClick={onClose} className="rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-medium">Close</button></div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-3">
            {fields.map(([field, label]) => (
              <div key={field} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-white/35">{label}</p>
                {editMode ? <ModalEditField modalType={modal.type} field={field} value={form[field] || ""} form={form} onChange={onChange} /> : <p className="mt-3 break-words text-sm text-white/80">{form[field] || "-"}</p>}
              </div>
            ))}
          </div>
        </div>
        {editMode && <div className="flex justify-end gap-3 border-t border-white/10 p-5"><button onClick={onCancel} className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-medium">Cancel</button><button onClick={onSave} className="rounded-2xl bg-[#AC00FF] px-5 py-3 text-sm font-medium">Save Changes</button></div>}
      </div>
    </div>
  );
}

function ModalEditField({ modalType, field, value, form, onChange }: { modalType: "client" | "admin" | "staff"; field: string; value: string; form: Record<string, string>; onChange: (field: string, value: string) => void }) {
  const inputClass = "mt-2 h-10 w-full rounded-xl border border-white/10 bg-[#101935] px-3 text-sm outline-none transition focus:border-[#AC00FF]";
  if (field === "status") {
    const options = modalType === "staff" ? ["active", "suspended"] : ["active", "pending", "suspended"];
    return <select value={value} onChange={(e) => onChange(field, e.target.value)} className={inputClass}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  }
  if (modalType === "client" && field === "account_type") {
    return <select value={value} onChange={(e) => { const next = e.target.value; onChange("account_type", next); onChange("subscription_plan", next === "individual" ? form.subscription_plan || "free" : "paid"); onChange("billing_status", next === "individual" && form.subscription_plan === "free" ? "free" : "paid"); }} className={inputClass}><option value="individual">individual</option><option value="business">business</option><option value="enterprise">enterprise</option></select>;
  }
  if (modalType === "client" && field === "subscription_plan") {
    const isIndividual = form.account_type === "individual";
    return <select value={isIndividual ? value : "paid"} disabled={!isIndividual} onChange={(e) => { onChange("subscription_plan", e.target.value); onChange("billing_status", e.target.value === "free" ? "free" : "paid"); }} className={inputClass}>{isIndividual ? <><option value="free">free</option><option value="paid">paid</option></> : <option value="paid">paid</option>}</select>;
  }
  if (modalType === "client" && field === "billing_status") {
    const controlled = form.account_type === "individual" && form.subscription_plan === "free" ? "free" : "paid";
    return <select value={controlled} disabled className={inputClass}><option value="free">free</option><option value="paid">paid</option></select>;
  }
  return <input value={value} onChange={(e) => onChange(field, e.target.value)} className={inputClass} />;
}

function TableMessage({ message }: { message: string }) {
  return <tr><td colSpan={8} className="p-5 text-white/50">{message}</td></tr>;
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
  const template = templates.find((item) => item.id === card.template_id) || fallbackTemplate;
  const data = user ? { ...card, full_name: user.full_name || user.name || card.full_name, job_title: user.job_title || card.job_title, email: user.email || card.email, phone: user.phone || card.phone, website: user.website || card.website, address: user.address || card.address, whatsapp: user.whatsapp || card.whatsapp, linkedin: user.linkedin || card.linkedin, instagram: user.instagram || card.instagram, facebook: user.facebook || card.facebook, youtube: user.youtube || card.youtube, booking_link: user.booking_link || card.booking_link, custom_url: user.custom_url || card.custom_url } : card;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-[#0F0E38] text-white shadow-2xl shadow-[#AC00FF]/20">
        <div className="flex items-start justify-between gap-6 border-b border-white/10 p-6">
          <div><h2 className="text-2xl font-semibold">Card Preview</h2><p className="mt-1 text-sm text-white/45">{card.card_name || card.name || "Digital card"} · {template.name}</p></div>
          <div className="flex items-center gap-3">
            {cards.length > 1 && <><button onClick={onPrevious} className="rounded-2xl bg-white/10 px-4 py-2.5 text-sm">←</button><span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-medium text-purple-100">Card {currentIndex + 1} of {cards.length}</span><button onClick={onNext} className="rounded-2xl bg-white/10 px-4 py-2.5 text-sm">→</button></>}
            <button onClick={() => onDeleteCard(card)} className="rounded-2xl bg-red-500/15 px-5 py-2.5 text-sm font-medium text-red-200 transition hover:bg-red-500/25">Delete Card</button>
            <button onClick={onClose} className="rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-medium">Close</button>
          </div>
        </div>
        <div className="max-h-[calc(85vh-104px)] overflow-y-auto p-6">
          <p className="mb-4 text-center text-xs text-white/35">
            Admin deletion is for support and enterprise management only.
          </p>
          <div className="mx-auto max-w-md"><CardRenderer mode="preview" showActions={template.supports_save_contact ?? true} template={template} cardData={data} /></div>
        </div>
      </div>
    </div>
  );
}

function ClientActions({ client, onView, onToggle }: { client: Client; onView: (client: Client) => void; onToggle: (client: Client) => void }) {
  return <div className="flex gap-3"><button onClick={() => onView(client)} className="text-sm text-blue-300 hover:text-blue-200">View</button><button onClick={() => onToggle(client)} className="text-sm text-yellow-300 hover:text-yellow-200">{client.status === "suspended" ? "Reactivate Client" : "Suspend Client"}</button></div>;
}

function BillingBadge({ status }: { status: string }) {
  const styles = status === "paid" ? "bg-green-500/20 text-green-300" : status === "trial" ? "bg-yellow-500/20 text-yellow-300" : status === "overdue" ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white/50";
  return <span className={`rounded-full px-3 py-1 text-xs capitalize ${styles}`}>{status}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const styles = status === "active" ? "bg-green-500/20 text-green-300" : status === "pending" ? "bg-yellow-500/20 text-yellow-300" : "bg-red-500/20 text-red-300";
  return <span className={`rounded-full px-3 py-1 text-xs capitalize ${styles}`}>{status}</span>;
}

function CardStatusBadge({ status }: { status: string }) {
  const styles = status === "published" ? "bg-green-500/20 text-green-300" : status === "draft" ? "bg-yellow-500/20 text-yellow-300" : "bg-white/10 text-white/50";
  return <span className={`rounded-full px-3 py-1 text-xs capitalize ${styles}`}>{status}</span>;
}
