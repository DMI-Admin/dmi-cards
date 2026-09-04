"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Loader2,
  Mail,
  MailPlus,
  Send,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";

import {
  ClientPortalHeader,
  ClientPortalPage,
  clientButtonClass,
} from "@/components/ClientPortalShell";
import {
  emailAutomationTriggerLabels,
  emailAutomationTriggerTypes,
  emailTemplateMergeVariables,
  type EmailAutomationSummary,
  type EmailAutomationRunSummary,
  type EmailConnectionSummary,
  type EmailTemplateSummary,
} from "@/lib/email/types";
import { emailProviderCatalog } from "@/lib/email/providers";
import { supabase } from "@/lib/supabase";
import { useClientPlan } from "@/lib/use-client-plan";

type ComingNextModal = {
  title: string;
  message: string;
} | null;

type DisconnectPrompt = {
  provider: "gmail" | "outlook";
  name: string;
} | null;

type TestEmailPrompt = {
  to: string;
  subject: string;
  body: string;
  from: string | null;
} | null;

const automations: EmailAutomationSummary[] = [];
const templates: EmailTemplateSummary[] = [];
const recentRuns: EmailAutomationRunSummary[] = [];

export default function ClientEmailAutomationsPage() {
  const { plan, loading } = useClientPlan();
  const [modal, setModal] = useState<ComingNextModal>(null);
  const [disconnectPrompt, setDisconnectPrompt] = useState<DisconnectPrompt>(null);
  const [connections, setConnections] = useState<EmailConnectionSummary[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    initialOAuthMessage
  );
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState({
    to: "",
    subject: "",
    body: "",
  });
  const [testEmailPrompt, setTestEmailPrompt] = useState<TestEmailPrompt>(null);
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailMessage, setTestEmailMessage] = useState<string | null>(null);
  const overview = useMemo(
    () => ({
      activeAutomations: automations.filter(
        (automation) => automation.status === "enabled"
      ).length,
      emailsSent: recentRuns.filter((run) => run.status === "sent").length,
      pending: recentRuns.filter(
        (run) => run.status === "scheduled" || run.status === "sending"
      ).length,
      failed: recentRuns.filter((run) => run.status === "failed").length,
    }),
    []
  );
  const planLabel = loading ? "Checking plan" : `${plan || "Free"} plan`;
  const gmailConnection = connections.find(
    (connection) => connection.provider === "gmail"
  );
  const gmailConnected = gmailConnection?.status === "connected";

  const authHeaders = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Authentication is required.");
    }

    return {
      Authorization: `Bearer ${session.access_token}`,
    };
  }, []);

  const loadConnections = useCallback(async () => {
    try {
      setConnectionsLoading(true);
      const response = await fetch("/api/client/email/connections", {
        headers: await authHeaders(),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { connections?: EmailConnectionSummary[] };
      };

      if (!response.ok) {
        throw new Error("Could not load email connections.");
      }

      setConnections(payload.data?.connections || []);
    } catch {
      setConnectionMessage("Could not load email connection status.");
    } finally {
      setConnectionsLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadConnections();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadConnections]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("email_oauth");

    if (!status) return;

    params.delete("email_oauth");
    params.delete("provider");
    params.delete("message");

    const nextUrl = `${window.location.pathname}${
      params.toString() ? `?${params.toString()}` : ""
    }`;
    window.history.replaceState(null, "", nextUrl);
  }, []);

  function comingNext(title: string, message: string) {
    setModal({ title, message });
  }

  async function connectProvider(provider: "gmail" | "outlook") {
    const routeProvider = provider === "gmail" ? "google" : "microsoft";

    try {
      setBusyProvider(provider);
      setConnectionMessage(null);
      const response = await fetch(
        `/api/client/email/${routeProvider}/connect?returnTo=${encodeURIComponent(
          "/client/email-automations"
        )}`,
        {
          headers: await authHeaders(),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { authorizationUrl?: string };
        error?: { message?: string };
      };

      if (!response.ok || !payload.data?.authorizationUrl) {
        throw new Error(payload.error?.message || "Connection is not configured.");
      }

      window.location.assign(payload.data.authorizationUrl);
    } catch (error) {
      setConnectionMessage(
        error instanceof Error
          ? error.message
          : "Could not start the email connection."
      );
      setBusyProvider(null);
    }
  }

  async function disconnectProvider(provider: "gmail" | "outlook") {
    const routeProvider = provider === "gmail" ? "google" : "microsoft";

    try {
      setBusyProvider(provider);
      setConnectionMessage(null);
      const response = await fetch(`/api/client/email/${routeProvider}/disconnect`, {
        method: "POST",
        headers: await authHeaders(),
      });

      if (!response.ok) {
        throw new Error("Could not disconnect the email account.");
      }

      setConnectionMessage("Email account disconnected.");
      setDisconnectPrompt(null);
      await loadConnections();
    } catch {
      setConnectionMessage("Could not disconnect the email account.");
    } finally {
      setBusyProvider(null);
    }
  }

  function requestTestEmailSend() {
    setTestEmailMessage(null);
    setTestEmailPrompt({
      ...testEmail,
      from: gmailConnection?.providerAccountEmail || null,
    });
  }

  async function sendTestEmail() {
    if (!testEmailPrompt) return;

    try {
      setTestEmailSending(true);
      setTestEmailMessage(null);
      const response = await fetch("/api/client/email/google/test-send", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          to: testEmailPrompt.to,
          subject: testEmailPrompt.subject,
          body: testEmailPrompt.body,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(payload.error?.message || "Could not send test email.");
      }

      setTestEmailMessage("Test email sent successfully.");
      setTestEmailPrompt(null);
    } catch (error) {
      setTestEmailMessage(
        error instanceof Error ? error.message : "Could not send test email."
      );
    } finally {
      setTestEmailSending(false);
    }
  }

  return (
    <ClientPortalPage>
      <div className="client-portal-page-shell">
        <ClientPortalHeader
          title="Email Automations"
          description="Automatically follow up with people who connect through your digital business card."
          action={
            <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              <Sparkles className="h-4 w-4 text-[var(--text-accent)]" />
              {planLabel}
            </span>
          }
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
          <div className="space-y-6">
            <Panel
              eyebrow="Connection"
              title="Email connection"
              description="Connect the mailbox that will eventually send approved follow-up emails."
            >
              {connectionMessage && (
                <div className="mb-4 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-secondary)]">
                  {connectionMessage}
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {emailProviderCatalog.map((provider) => {
                  const connection = connections.find(
                    (item) => item.provider === provider.id
                  );
                  const Icon = provider.id === "gmail" ? Mail : Send;

                  return (
                    <ProviderCard
                      key={provider.id}
                      icon={Icon}
                      name={provider.name}
                      description={provider.description}
                      status={
                        connectionsLoading
                          ? "loading"
                          : connection?.status || "not_connected"
                      }
                      accountEmail={connection?.providerAccountEmail || null}
                      busy={busyProvider === provider.id}
                      onConnect={() => connectProvider(provider.id)}
                      onDisconnect={() =>
                        setDisconnectPrompt({
                          provider: provider.id,
                          name: provider.name,
                        })
                      }
                    />
                  );
                })}
              </div>
            </Panel>

            <Panel
              eyebrow="Automations"
              title="Automation overview"
              description="These figures will come from automation runs once sending is enabled."
            >
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Active automations"
                  value={overview.activeAutomations}
                  icon={Workflow}
                />
                <MetricCard label="Emails sent" value={overview.emailsSent} icon={Send} />
                <MetricCard label="Pending" value={overview.pending} icon={Clock3} />
                <MetricCard label="Failed" value={overview.failed} icon={AlertTriangle} />
              </div>
            </Panel>

            <Panel
              eyebrow="Workflow"
              title="Automations"
              description="Start with contact-captured follow-ups, then expand into other client-owned triggers."
              action={
                <button
                  type="button"
                  onClick={() =>
                    comingNext(
                      "Create automation",
                      "Automation creation will be enabled after provider connections, templates, unsubscribe handling, and run scheduling are wired to the database."
                    )
                  }
                  className={clientButtonClass.primary}
                >
                  <MailPlus className="h-4 w-4" />
                  Create automation
                </button>
              }
            >
              <EmptyState
                icon={Workflow}
                title="No automations yet"
                message="Your first automation will be triggered by a contact captured through your public DMI Card."
              />
            </Panel>

            {gmailConnected && (
              <Panel
                eyebrow="Test"
                title="Test Gmail send"
                description="Send one manually approved plain-text test email from the connected Gmail account."
              >
                {testEmailMessage && (
                  <div className="mb-4 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-secondary)]">
                    {testEmailMessage}
                  </div>
                )}
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    requestTestEmailSend();
                  }}
                >
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                      Recipient
                    </span>
                    <input
                      type="email"
                      required
                      value={testEmail.to}
                      onChange={(event) =>
                        setTestEmail((current) => ({
                          ...current,
                          to: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--text-accent)]"
                      placeholder="recipient@example.com"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                      Subject
                    </span>
                    <input
                      type="text"
                      required
                      maxLength={180}
                      value={testEmail.subject}
                      onChange={(event) =>
                        setTestEmail((current) => ({
                          ...current,
                          subject: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--text-accent)]"
                      placeholder="DMI Cards test email"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                      Message
                    </span>
                    <textarea
                      required
                      maxLength={10000}
                      rows={5}
                      value={testEmail.body}
                      onChange={(event) =>
                        setTestEmail((current) => ({
                          ...current,
                          body: event.target.value,
                        }))
                      }
                      className="mt-2 w-full resize-y rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--text-accent)]"
                      placeholder="Write a short plain-text test message."
                    />
                  </label>
                  <button
                    type="submit"
                    className={clientButtonClass.primary}
                    disabled={testEmailSending}
                  >
                    {testEmailSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send test email
                  </button>
                </form>
              </Panel>
            )}
          </div>

          <div className="space-y-6">
            <Panel
              eyebrow="Templates"
              title="Email templates"
              description="Prepare safe follow-up templates with approved merge variables."
              action={
                <button
                  type="button"
                  onClick={() =>
                    comingNext(
                      "Create email template",
                      "Template storage and preview will be added once the owner-scoped email tables are approved."
                    )
                  }
                  className={clientButtonClass.secondary}
                >
                  <MailPlus className="h-4 w-4" />
                  Create template
                </button>
              }
            >
              <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  Supported template fields
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {emailTemplateMergeVariables.map((variable) => (
                    <span
                      key={variable}
                      className="rounded-full border border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]"
                    >
                      {variable}
                    </span>
                  ))}
                </div>
              </div>
              {templates.length === 0 && (
                <EmptyState
                  icon={Mail}
                  title="No templates yet"
                  message="Templates will include a name, subject, body, and enabled or archived status."
                />
              )}
            </Panel>

            <Panel
              eyebrow="Activity"
              title="Recent activity"
              description="Sending history will appear here after automation runs exist."
            >
              <EmptyState
                icon={Activity}
                title="No email activity"
                message="No emails have been scheduled, sent, or failed because sending is not active in Phase 1."
              />
            </Panel>

            <Panel
              eyebrow="Safety"
              title="Future trigger model"
              description="Automation triggers must always be scoped to the contact owner."
            >
              <div className="space-y-3">
                {emailAutomationTriggerTypes.map((trigger) => (
                  <div
                    key={trigger}
                    className="flex items-center gap-3 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3"
                  >
                    <CheckCircle2 className="h-4 w-4 text-[var(--text-accent)]" />
                    <span className="text-sm font-semibold text-[var(--text-primary)]">
                      {emailAutomationTriggerLabels[trigger]}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {modal && (
        <ComingNextDialog
          title={modal.title}
          message={modal.message}
          onClose={() => setModal(null)}
        />
      )}
      {disconnectPrompt && (
        <DisconnectDialog
          providerName={disconnectPrompt.name}
          busy={busyProvider === disconnectPrompt.provider}
          onCancel={() => setDisconnectPrompt(null)}
          onConfirm={() => disconnectProvider(disconnectPrompt.provider)}
        />
      )}
      {testEmailPrompt && (
        <TestEmailDialog
          prompt={testEmailPrompt}
          busy={testEmailSending}
          onCancel={() => setTestEmailPrompt(null)}
          onConfirm={sendTestEmail}
        />
      )}
    </ClientPortalPage>
  );
}

function Panel({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 shadow-[var(--shadow-sm)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--text-accent)]">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
            {description}
          </p>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ProviderCard({
  icon: Icon,
  name,
  description,
  status,
  accountEmail,
  busy,
  onConnect,
  onDisconnect,
}: {
  icon: LucideIcon;
  name: string;
  description: string;
  status: string;
  accountEmail: string | null;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = status === "connected";
  const reconnectRequired =
    status === "reconnect_required" || status === "revoked" || status === "error";

  return (
    <article className="flex h-full flex-col rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] text-[var(--text-accent)]">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {name}
          </h3>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            {statusLabel(status)}
          </p>
        </div>
      </div>
      <p className="mt-4 flex-1 text-sm leading-6 text-[var(--text-secondary)]">
        {description}
      </p>
      {accountEmail && (
        <p className="mt-3 truncate text-xs text-[var(--text-secondary)]">
          Connected as {accountEmail}
        </p>
      )}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onConnect}
          disabled={busy || status === "loading"}
          className={`${connected ? clientButtonClass.secondary : clientButtonClass.primary} w-full`}
        >
          {busy
            ? "Working..."
            : connected
              ? "Reconnect"
              : reconnectRequired
                ? "Reconnect"
                : "Connect"}
          <ArrowRight className="h-4 w-4" />
        </button>
        {connected || reconnectRequired ? (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy}
            className={`${clientButtonClass.secondary} w-full`}
          >
            Disconnect
          </button>
        ) : null}
      </div>
    </article>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
          {label}
        </p>
        <Icon className="h-4 w-4 text-[var(--text-accent)]" />
      </div>
      <p className="mt-4 text-3xl font-semibold text-[var(--text-primary)]">
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  message,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-6 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] text-[var(--text-accent)]">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-3 text-base font-semibold text-[var(--text-primary)]">
        {title}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
        {message}
      </p>
    </div>
  );
}

function ComingNextDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 text-[var(--text-primary)] shadow-[0_28px_90px_rgba(0,0,0,0.36)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-accent)]">
              Coming next
            </p>
            <h2 className="mt-2 text-xl font-semibold">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)] transition hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
          {message}
        </p>
        <button
          type="button"
          onClick={onClose}
          className={`${clientButtonClass.primary} mt-5 w-full`}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

function DisconnectDialog({
  providerName,
  busy,
  onCancel,
  onConfirm,
}: {
  providerName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 text-[var(--text-primary)] shadow-[0_28px_90px_rgba(0,0,0,0.36)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-accent)]">
              Disconnect account
            </p>
            <h2 className="mt-2 text-xl font-semibold">{providerName}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)] transition hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
          This will remove the saved email connection for this provider. No
          emails will be sent and your existing cards, contacts, and
          automations are not changed.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`${clientButtonClass.secondary} w-full`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`${clientButtonClass.primary} w-full`}
          >
            {busy ? "Disconnecting..." : "Disconnect"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TestEmailDialog({
  prompt,
  busy,
  onCancel,
  onConfirm,
}: {
  prompt: NonNullable<TestEmailPrompt>;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 text-[var(--text-primary)] shadow-[0_28px_90px_rgba(0,0,0,0.36)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-accent)]">
              Confirm send
            </p>
            <h2 className="mt-2 text-xl font-semibold">Send test email?</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)] transition hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
          Send this test email now from{" "}
          <span className="font-semibold text-[var(--text-primary)]">
            {prompt.from || "the connected Gmail account"}
          </span>{" "}
          to{" "}
          <span className="font-semibold text-[var(--text-primary)]">
            {prompt.to}
          </span>
          ?
        </p>
        <div className="mt-4 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            Subject
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
            {prompt.subject}
          </p>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`${clientButtonClass.secondary} w-full`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`${clientButtonClass.primary} w-full`}
          >
            {busy ? "Sending..." : "Send now"}
          </button>
        </div>
      </div>
    </div>
  );
}

function statusLabel(status: string) {
  if (status === "loading") return "Checking";
  if (status === "reconnect_required") return "Reconnect required";
  if (status === "not_connected") return "Not connected";

  return status.replace(/_/g, " ");
}

function initialOAuthMessage() {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const status = params.get("email_oauth");
  const provider = params.get("provider");

  if (!status) return null;

  const providerLabel =
    provider === "microsoft"
      ? "Microsoft Outlook"
      : provider === "google"
        ? "Google Gmail"
        : "Email provider";

  return status === "success"
    ? `${providerLabel} connected successfully.`
    : `${providerLabel} could not be connected. Please try again.`;
}
