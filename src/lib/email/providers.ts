import type { EmailProviderId } from "@/lib/email/types";

export type EmailProviderAccount = {
  provider: EmailProviderId;
  email: string | null;
  displayName: string | null;
};

export type EmailSendMessageInput = {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  idempotencyKey: string;
};

export type EmailSendMessageResult = {
  providerMessageId: string;
  threadId?: string | null;
};

export type EmailProvider = {
  id: EmailProviderId;
  displayName: string;
  getAccount(): Promise<EmailProviderAccount>;
  refreshConnection(): Promise<EmailProviderAccount>;
  sendMessage(input: EmailSendMessageInput): Promise<EmailSendMessageResult>;
  disconnect(): Promise<void>;
};

export const emailProviderCatalog: {
  id: EmailProviderId;
  name: string;
  description: string;
}[] = [
  {
    id: "gmail",
    name: "Google Gmail",
    description:
      "Send follow-up emails from a connected Gmail or Google Workspace account.",
  },
  {
    id: "outlook",
    name: "Microsoft Outlook",
    description:
      "Send follow-up emails from Microsoft Outlook or Microsoft 365.",
  },
];

export function createUnavailableEmailProvider(
  id: EmailProviderId,
  displayName: string
): EmailProvider {
  async function unavailable(): Promise<never> {
    throw new Error(`${displayName} email provider is not connected.`);
  }

  return {
    id,
    displayName,
    getAccount: unavailable,
    refreshConnection: unavailable,
    sendMessage: unavailable,
    disconnect: unavailable,
  };
}
