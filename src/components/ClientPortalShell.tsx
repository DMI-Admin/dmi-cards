import ClientSidebar from "@/components/ClientSidebar";

type ClientPortalPageProps = {
  children: React.ReactNode;
  className?: string;
};

type ClientPortalHeaderProps = {
  title: string;
  description: string;
  action?: React.ReactNode;
};

type ClientPortalWorkspaceProps = {
  children: React.ReactNode;
  preview: React.ReactNode;
  className?: string;
};

export const clientButtonClass = {
  primary:
    "dmi-gradient-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[image:var(--brand-gradient)] px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:text-white hover:shadow-[var(--shadow-brand)] active:text-white focus-visible:text-white disabled:cursor-not-allowed disabled:opacity-60 [&_*]:text-white",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-3 text-sm font-semibold text-[var(--button-secondary-text)] transition hover:-translate-y-0.5 hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60",
  utility:
    "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] transition hover:border-[var(--border-brand)] hover:bg-[var(--brand-gradient-subtle)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60",
  selected:
    "border-[#AC00FF]/70 bg-white text-[#101935] shadow-sm ring-2 ring-[#AC00FF]/35",
  setting:
    "border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)] hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)]",
};

export function ClientPortalPage({ children, className = "" }: ClientPortalPageProps) {
  return (
    <main className="client-portal-shell flex min-h-screen bg-[var(--background)] text-[var(--text-primary)]">
      <ClientSidebar />
      <section className={`client-portal-page flex-1 ${className}`}>
        {children}
      </section>
    </main>
  );
}

export function ClientPortalHeader({
  title,
  description,
  action,
}: ClientPortalHeaderProps) {
  return (
    <div className="client-portal-header mb-6 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
      <div>
        <h1 className="text-4xl font-bold tracking-normal sm:text-5xl">{title}</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-[var(--text-secondary)]">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

export function ClientPortalWorkspace({
  children,
  preview,
  className = "",
}: ClientPortalWorkspaceProps) {
  return (
    <div className={`client-portal-workspace ${className}`}>
      <div className="min-w-0 space-y-6">{children}</div>
      <aside className="client-portal-preview min-w-0">{preview}</aside>
    </div>
  );
}
