import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  CheckCircle2,
  FileQuestion,
  Headphones,
  Lightbulb,
  LifeBuoy,
  Paperclip,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";

const supportCards = [
  {
    title: "Help Centre",
    description: "Browse guides for cards, QR codes, wallet passes, and sharing.",
    icon: FileQuestion,
  },
  {
    title: "Contact Support",
    description: "Send a support request to the DMI Cards team.",
    icon: Headphones,
  },
  {
    title: "System Status",
    description: "All DMI Cards services are currently operational.",
    icon: ShieldCheck,
  },
  {
    title: "Feature Requests",
    description: "Suggest improvements for future releases.",
    icon: Lightbulb,
  },
];

const faqs = [
  {
    question: "How do I edit my digital card?",
    answer:
      "Open My Cards, choose your card, then click Edit Card. Changes can be previewed before saving or publishing.",
  },
  {
    question: "How do I share my card?",
    answer:
      "You can share your public card URL, QR code, wallet pass, or Tap to Share link depending on your plan.",
  },
  {
    question: "How do I use QR codes?",
    answer:
      "Go to QR Code in the client portal to preview, customise, and download a QR code linked to your public card.",
  },
  {
    question: "How do I add my card to Wallet?",
    answer:
      "Open Wallet to preview Apple Wallet and Google Wallet passes. Real wallet generation will be connected later.",
  },
  {
    question: "How do I upgrade to Individual Pro?",
    answer:
      "Open Billing and choose Upgrade to Individual Pro. Billing will be securely managed through Stripe later.",
  },
  {
    question: "How do integrations work?",
    answer:
      "Paid plans can connect CRM and automation tools so captured contacts sync automatically once integrations are connected.",
  },
];

const recentTickets = [
  {
    id: "SUP-1042",
    subject: "Need help updating my public card URL",
    category: "Digital Cards",
    status: "Open",
    updated: "Today, 10:24",
  },
  {
    id: "SUP-1038",
    subject: "Wallet pass preview question",
    category: "Wallet",
    status: "In Review",
    updated: "Yesterday, 16:05",
  },
  {
    id: "SUP-1029",
    subject: "QR code download size",
    category: "QR Codes",
    status: "Resolved",
    updated: "May 9, 2026",
  },
];

export default function ClientSupportPage() {
  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <ClientSidebar />

      <section className="flex-1 p-10">
        <div className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#AC00FF]">
              Client Portal
            </p>
            <h1 className="mt-3 text-4xl font-bold">Support</h1>
            <p className="mt-3 max-w-4xl text-white/50">
              Get help with your DMI Cards account, digital cards, QR codes,
              wallet passes, and integrations.
            </p>
          </div>

          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35"
          >
            <LifeBuoy className="h-4 w-4" />
            New Support Request
          </button>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {supportCards.map((card) => (
            <SupportCard key={card.title} {...card} />
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,0.65fr)]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="FAQ"
                description="Quick answers to common DMI Cards questions."
              />

              <div className="mt-6 space-y-3">
                {faqs.map((faq) => (
                  <details
                    key={faq.question}
                    className="group rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-[#AC00FF]/35 hover:bg-[#AC00FF]/10"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                      <span>{faq.question}</span>
                      <ArrowUpRight className="h-4 w-4 text-white/40 transition group-open:rotate-45 group-hover:text-purple-100" />
                    </summary>
                    <p className="mt-3 text-sm leading-6 text-white/55">
                      {faq.answer}
                    </p>
                  </details>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 shadow-2xl shadow-black/20">
              <div className="border-b border-white/10 p-6">
                <SectionTitle
                  title="Recent Tickets"
                  description="Mock ticket history. Backend ticketing will be connected later."
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead className="bg-[#0B1024] text-left text-xs uppercase tracking-[0.14em] text-white/40">
                    <tr>
                      <th className="px-6 py-4">Ticket ID</th>
                      <th className="px-6 py-4">Subject</th>
                      <th className="px-6 py-4">Category</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTickets.map((ticket) => (
                      <tr
                        key={ticket.id}
                        className="border-t border-white/5 hover:bg-white/[0.03]"
                      >
                        <td className="px-6 py-5 font-semibold text-purple-100">
                          {ticket.id}
                        </td>
                        <td className="px-6 py-5">
                          <p className="font-medium">{ticket.subject}</p>
                        </td>
                        <td className="px-6 py-5 text-white/60">
                          {ticket.category}
                        </td>
                        <td className="px-6 py-5">
                          <StatusBadge status={ticket.status} />
                        </td>
                        <td className="px-6 py-5 text-white/60">
                          {ticket.updated}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="space-y-6 xl:sticky xl:top-8 xl:self-start">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Submit Ticket"
                description="Tell us what you need help with. This form is visual-only for now."
              />

              <form className="mt-6 space-y-4">
                <Field label="Subject">
                  <input
                    placeholder="Briefly describe the issue"
                    className="inputStyle"
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Category">
                    <select className="inputStyle" defaultValue="">
                      <option value="" disabled>
                        Select category
                      </option>
                      <option>Digital Cards</option>
                      <option>QR Codes</option>
                      <option>Wallet</option>
                      <option>Tap to Share</option>
                      <option>Integrations</option>
                      <option>Billing</option>
                    </select>
                  </Field>

                  <Field label="Priority">
                    <select className="inputStyle" defaultValue="Normal">
                      <option>Low</option>
                      <option>Normal</option>
                      <option>High</option>
                      <option>Urgent</option>
                    </select>
                  </Field>
                </div>

                <Field label="Message">
                  <textarea
                    placeholder="Share any details that will help the DMI Cards team understand the request."
                    rows={6}
                    className="inputStyle min-h-36 resize-none py-3"
                  />
                </Field>

                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-5 text-sm font-semibold text-white/60 transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10 hover:text-white"
                >
                  <Paperclip className="h-4 w-4" />
                  Attach screenshot placeholder
                </button>

                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#AC00FF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:bg-[#BE35FF]"
                >
                  <Send className="h-4 w-4" />
                  Submit Request
                </button>
              </form>
            </section>

            <section className="rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-6 shadow-lg shadow-purple-950/15">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#AC00FF]/20">
                  <Sparkles className="h-6 w-6 text-purple-100" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">Support roadmap</h2>
                  <p className="mt-3 text-sm leading-6 text-white/60">
                    Ticket submission, attachments, status updates, and support
                    notifications will connect to a backend later.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function SupportCard({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <article className="min-h-44 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/10 transition hover:border-[#AC00FF]/35 hover:bg-[#AC00FF]/10">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-200">
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="mt-5 text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/50">{description}</p>
    </article>
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
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
        {label}
      </span>
      {children}
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "Resolved"
      ? "border-green-400/20 bg-green-500/15 text-green-200"
      : status === "In Review"
      ? "border-yellow-300/20 bg-yellow-500/15 text-yellow-100"
      : "border-blue-400/20 bg-blue-500/15 text-blue-200";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${styles}`}
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
    </div>
  );
}
