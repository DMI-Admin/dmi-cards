"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminInteraction } from "@/components/AdminInteractionDialog";
import { mutateAdminCard } from "@/lib/admin-card-mutations";
import { downloadCompanyReport } from "@/lib/admin-company-report";
import Sidebar from "@/components/Sidebar";
import styles from "./cards.module.css";
import { useAdminDialog } from "@/hooks/useAdminDialog";
import type { SupportCard, SupportInventory } from "@/lib/admin-card-support";

const control = "inputStyle min-w-0 w-full";
const button = "rounded-xl border border-[var(--dmi-border)] bg-[var(--button-secondary-bg)] px-3 py-2 text-sm text-[var(--button-secondary-text)] disabled:opacity-50 disabled:cursor-not-allowed";
function date(value: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not recorded"; }
function accountLabel(value: SupportCard["accountType"]) { return value === "business" ? "Business" : value === "individual" ? "Individual" : "Unknown linkage"; }

export default function CardsPage() {
  const [filters, setFilters] = useState({ search: "", account: "all", publication: "all", page: 1 });
  const [searchDraft, setSearchDraft] = useState("");
  const [inventory, setInventory] = useState<SupportInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<SupportCard | null>(null);
  const interaction = useAdminInteraction();
  const actionLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  async function unpublish(card: SupportCard) {
    if (!card.published || actionLock.current) return;
    actionLock.current = true; setBusy(true); setFeedback(null);
    try {
      if (!await interaction.confirm(`Unpublish ${card.name}? The public card will stop being publicly accessible. The card and its data will not be deleted.`)) return;
      await mutateAdminCard(`/api/admin/cards/${card.id}`, "PATCH", { operation: "unpublish" });
      setFeedback({ error: false, text: `${card.name} unpublished. Refreshing inventory…` });
      setRetry(value => value + 1);
    } catch (cause) {
      setFeedback({ error: true, text: `Unpublish could not be confirmed. Refresh the inventory before retrying. ${cause instanceof Error ? cause.message : "Please retry."}` });
      setRetry(value => value + 1);
    } finally { actionLock.current = false; setBusy(false); }
  }
  async function exportCompany(card: SupportCard) {
    if (card.accountType !== "business" || !card.clientId || actionLock.current) return;
    actionLock.current = true; setBusy(true); setFeedback(null);
    try {
      if (!await interaction.confirm(`Export CSV for ${card.company || "this company"}? Includes staff names and emails for company cards matching the current search, across all pages and publication states. The publication filter does not apply. Views, saves and shares are placeholder zeros.`)) return;
      const params = new URLSearchParams({ clientId: card.clientId, search: filters.search });
      const response = await fetch(`/api/admin/cards/support/export?${params}`, { method: "GET", cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Company export failed.");
      downloadCompanyReport(result);
      setFeedback({ error: false, text: `Company CSV downloaded (${result.count} cards).` });
    } catch (cause) { setFeedback({ error: true, text: cause instanceof Error ? cause.message : "Company export failed." }); }
    finally { actionLock.current = false; setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true); setError(""); setSelected(null);
      try {
        const params = new URLSearchParams({ ...filters, page: String(filters.page) });
        const response = await fetch(`/api/admin/cards/support?${params}`, { method: "GET", cache: "no-store", credentials: "same-origin", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Cards could not be loaded.");
        if (active) setInventory(data);
      } catch (cause) {
        if (active) { setInventory(null); setError(cause instanceof Error ? cause.message : "Cards could not be loaded."); }
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [filters, retry]);
  const totalPages = Math.max(1, Math.ceil((inventory?.total || 0) / (inventory?.pageSize || 25)));
  const summary = inventory?.summary;
  return (
    <main className="dmi-app-shell flex min-h-screen flex-col md:flex-row">
      <div className="hidden md:block"><Sidebar /></div>
      <details className="border-b border-[var(--dmi-border)] p-3 md:hidden [&_aside]:relative [&_aside]:h-auto [&_aside]:w-full">
        <summary className="cursor-pointer font-semibold">Admin navigation</summary><Sidebar />
      </details>
      <section className="dmi-page space-y-6">
        <header><h1 className="text-3xl font-semibold">Card Management</h1><p className="mt-2 text-sm text-[var(--dmi-muted)]">Locate and inspect cards for support and card administration. Inspect card details, unpublish cards, and export company reports.</p></header>
        <section aria-label="All cards summary"><p className="mb-2 text-xs text-[var(--dmi-muted)]">All cards — totals are independent of the filters below.</p>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            {([['Total Cards', summary?.total], ['Published', summary?.published], ['Draft / Unpublished', summary?.unpublished], ['Business Cards', summary?.business], ['Individual Cards', summary?.individual]] as const).map(([label, value]) => <div key={label} className="dmi-card p-4"><p className="text-xs text-[var(--dmi-muted)]">{label}</p><p className="mt-2 text-2xl font-semibold">{loading ? "…" : value ?? "—"}</p></div>)}
          </div>
          {summary && summary.total > summary.business + summary.individual && <p className="mt-2 text-xs text-[var(--dmi-muted)]">{summary.total - summary.business - summary.individual} cards have unknown account linkage and remain visible under All or Unknown linkage.</p>}
        </section>
        <form className={`${styles.filters} dmi-card grid items-end gap-3 p-4 lg:grid-cols-[minmax(180px,1fr)_180px_180px_auto]`} onSubmit={event => { event.preventDefault(); setFilters(current => ({ ...current, search: searchDraft.trim(), page: 1 })); }}>
          <label className="text-sm">Search<input className={`${control} mt-1`} value={searchDraft} maxLength={80} onChange={event => setSearchDraft(event.target.value)} placeholder="Card name, owner name, company or slug" /></label>
          <label className="text-sm">Account type<select className={`${control} mt-1`} value={filters.account} onChange={event => setFilters(current => ({ ...current, account: event.target.value, page: 1 }))}><option value="all">All</option><option value="individual">Individual</option><option value="business">Business</option><option value="unknown">Unknown linkage</option></select></label>
          <label className="text-sm">Publication<select className={`${control} mt-1`} value={filters.publication} onChange={event => setFilters(current => ({ ...current, publication: event.target.value, page: 1 }))}><option value="all">All</option><option value="published">Published</option><option value="unpublished">Draft / Unpublished</option></select></label>
          <button className={button} type="submit">Search</button>
        </form>
        {feedback && <p role={feedback.error ? "alert" : "status"} className="text-sm">{feedback.text}</p>}
        {error && <div role="alert" className="dmi-card p-4"><p>{error}</p><button className={`${button} mt-3`} onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
        {loading ? <p role="status">Loading cards…</p> : !error && inventory && <>
          <div className={`${styles.inventory} dmi-card overflow-hidden`}><div className="overflow-x-auto" role="region" aria-label="Card support inventory" tabIndex={0}>
            <table role="table"><caption className="sr-only">Card support inventory</caption>
              <thead role="rowgroup" className="bg-[var(--dmi-surface-soft)] text-xs text-[var(--dmi-muted)]"><tr role="row">{['Card Owner / Name','Company','Account Type','Template','Status','Published state','Public URL / slug','Last Updated','Actions'].map(label => <th role="columnheader" scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody role="rowgroup">{inventory.cards.map(card => <tr role="row" key={card.id} className="border-t border-[var(--dmi-border)] align-top">
                <td role="cell" data-label="Card Owner / Name" className="max-w-52 break-words"><p className="font-medium">{card.ownerName || "Owner name not recorded"}</p><p className="mt-1 text-xs text-[var(--dmi-muted)]">{card.name}</p></td>
                <td role="cell" data-label="Company" className="max-w-44 break-words">{card.company || "—"}{card.accountType === "business" && card.clientId && <button className={`${button} mt-2`} disabled={busy} onClick={() => void exportCompany(card)} aria-label={`Export company CSV: ${card.company || card.clientId}`}>Export company CSV</button>}</td><td role="cell" data-label="Account Type">{accountLabel(card.accountType)}</td><td role="cell" data-label="Template" className="max-w-40 break-words">{card.templateName || "Unavailable"}</td>
                <td role="cell" data-label="Status">{card.status || "Not recorded"}</td><td role="cell" data-label="Published state"><span data-publication-badge className="rounded-full bg-[var(--dmi-surface-soft)] text-xs">{card.published ? "Published" : "Unpublished"}</span></td>
                <td role="cell" data-label="Public URL / slug" className="max-w-48 break-all"><code data-public-slug className="text-xs">{card.publicPath || card.slug || "No slug"}</code></td><td role="cell" data-label="Last Updated" className="text-xs">{date(card.updatedAt)}</td>
                <td role="cell" data-label="Actions"><div data-support-actions><PublicAction card={card} /><button className={button} onClick={() => setSelected(card)} aria-label={`View Details: ${card.name}`}>View Details</button>{card.published && <button className={button} disabled={busy} onClick={() => void unpublish(card)} aria-label={`Unpublish: ${card.name}`}>Unpublish</button>}</div></td>
              </tr>)}</tbody>
            </table>
          </div>{inventory.cards.length === 0 && <p className="p-6 text-center text-sm text-[var(--dmi-muted)]">No cards found for this page and these filters.</p>}</div>
          <nav aria-label="Card pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>{inventory.total} matching cards · Page {filters.page} of {totalPages}</p><div className="flex gap-2"><button className={button} disabled={filters.page <= 1} onClick={() => setFilters(current => ({ ...current, page: current.page - 1 }))}>Previous</button><button className={button} disabled={filters.page >= totalPages || filters.page >= 9999} onClick={() => setFilters(current => ({ ...current, page: current.page + 1 }))}>Next</button></div></nav>
        </>}
      </section>
      {interaction.dialog}
      {selected && createPortal(<CardDetails card={selected} onClose={() => setSelected(null)} />, document.body)}
    </main>
  );
}

function PublicAction({ card }: { card: SupportCard }) {
  return card.publicPath ? <a className={button} href={card.publicPath} target="_blank" rel="noopener noreferrer">View Public Card</a>
    : <span><button className={button} disabled>View Public Card</button><span className="mt-1 block max-w-44 text-xs text-[var(--dmi-muted)]">{card.unavailableReason}</span></span>;
}

function CardDetails({ card, onClose }: { card: SupportCard; onClose: () => void }) {
  const dialog = useAdminDialog(onClose);
  const fields = [
    ["Card UUID", card.id], ["Card name", card.name], ["Owner name on card", card.ownerName], ["Owner user UUID", card.userId],
    ["Company", card.company], ["Client UUID", card.clientId], ["Account type", accountLabel(card.accountType)],
    ["Recorded client plan", card.recordedPlan], ["Template", card.templateName], ["Template UUID", card.templateId],
    ["Stored status", card.status], ["Publication", card.published ? "Published" : "Unpublished"], ["Public availability", card.publicPath ? "Available" : card.unavailableReason],
    ["Public route", card.publicPath], ["Stored slug", card.slug], ["Created", date(card.createdAt)], ["Last updated", date(card.updatedAt)],
  ];
  return <div {...dialog} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3 sm:p-6">
    <section className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] text-[var(--text-primary)] shadow-2xl">
      <header className="flex items-center justify-between gap-4 border-b border-[var(--dmi-border)] p-5"><div><h2 className="text-xl font-semibold">Card Details</h2><p className="mt-1 text-sm text-[var(--dmi-muted)]">Read-only support workspace</p></div><button data-dialog-initial-focus className={button} onClick={onClose}>Close</button></header>
      <div className="overflow-y-auto p-5"><dl className="grid gap-4 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="text-xs text-[var(--dmi-muted)]">{label}</dt><dd className="mt-1 break-words text-sm">{value || "Not recorded"}</dd></div>)}</dl><p className="mt-5 text-xs text-[var(--dmi-muted)]">Recorded client plan is reference metadata, not a live entitlement decision. Contact details, card media and captured leads are not included.</p></div>
      <footer className="border-t border-[var(--dmi-border)] p-5"><PublicAction card={card} /></footer>
    </section>
  </div>;
}
