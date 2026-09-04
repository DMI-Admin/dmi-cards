export const emailProviderIds = ["gmail", "outlook"] as const;

export type EmailProviderId = (typeof emailProviderIds)[number];

export type EmailConnectionStatus =
  | "not_connected"
  | "connected"
  | "reconnect_required"
  | "revoked"
  | "error"
  | "disconnected";

export const emailAutomationTriggerTypes = [
  "contact_captured",
  "contact_manually_added",
  "contact_qualified",
  "qr_lead_captured",
  "public_card_contact_submitted",
] as const;

export type EmailAutomationTriggerType =
  (typeof emailAutomationTriggerTypes)[number];

export type EmailAutomationStatus = "enabled" | "disabled" | "archived";

export type EmailAutomationRunStatus =
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type EmailConnectionSummary = {
  id: string;
  provider: EmailProviderId;
  providerAccountEmail: string | null;
  displayName: string | null;
  status: EmailConnectionStatus;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
  revokedAt: string | null;
};

export type EmailTemplateSummary = {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: "enabled" | "archived";
  createdAt: string | null;
  updatedAt: string | null;
};

export type EmailAutomationSummary = {
  id: string;
  name: string;
  triggerType: EmailAutomationTriggerType;
  templateId: string;
  emailConnectionId: string;
  delayMinutes: number;
  status: EmailAutomationStatus;
  lastRunAt: string | null;
};

export type EmailAutomationRunSummary = {
  id: string;
  automationId: string;
  contactId: string;
  status: EmailAutomationRunStatus;
  scheduledFor: string | null;
  sentAt: string | null;
  failureCode: string | null;
  createdAt: string | null;
};

export const emailTemplateMergeVariables = [
  "{{first_name}}",
  "{{last_name}}",
  "{{full_name}}",
  "{{company}}",
  "{{card_owner_name}}",
  "{{card_owner_company}}",
] as const;

export const emailAutomationTriggerLabels: Record<
  EmailAutomationTriggerType,
  string
> = {
  contact_captured: "Contact captured",
  contact_manually_added: "Contact manually added",
  contact_qualified: "Contact qualified",
  qr_lead_captured: "QR lead captured",
  public_card_contact_submitted: "Public card contact submitted",
};
