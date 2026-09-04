import "server-only";

import {
  disconnectEmailConnection,
  ensureEmailConnectionAccessToken,
  listEmailConnectionMetadata,
} from "@/lib/email/connections";
import {
  emailProviderCatalog,
  type EmailSendMessageInput,
  type EmailProvider,
} from "@/lib/email/providers";
import type { EmailProviderId } from "@/lib/email/types";
import { sendGoogleEmailMessage } from "@/lib/email/providers/google";

export type EmailProviderFactoryInput = {
  ownerUserId: string;
  provider: EmailProviderId;
};

export function createConnectedEmailProvider({
  ownerUserId,
  provider,
}: EmailProviderFactoryInput): EmailProvider {
  const displayName =
    emailProviderCatalog.find((item) => item.id === provider)?.name || provider;

  return {
    id: provider,
    displayName,
    async getAccount() {
      const connections = await listEmailConnectionMetadata(ownerUserId);
      const connection = connections.find((item) => item.provider === provider);

      if (!connection || connection.status !== "connected") {
        throw new Error(`${displayName} email provider is not connected.`);
      }

      return {
        provider,
        email: connection.providerAccountEmail,
        displayName: connection.displayName,
      };
    },
    async refreshConnection() {
      await ensureEmailConnectionAccessToken(ownerUserId, provider);
      const connections = await listEmailConnectionMetadata(ownerUserId);
      const connection = connections.find((item) => item.provider === provider);

      if (!connection) {
        throw new Error(`${displayName} email provider is not connected.`);
      }

      return {
        provider,
        email: connection.providerAccountEmail,
        displayName: connection.displayName,
      };
    },
    async sendMessage(input: EmailSendMessageInput) {
      if (provider !== "gmail") {
        throw new Error(`${displayName} sending is not enabled in this phase.`);
      }

      const accessToken = await ensureEmailConnectionAccessToken(
        ownerUserId,
        provider
      );
      const connections = await listEmailConnectionMetadata(ownerUserId);
      const connection = connections.find((item) => item.provider === provider);

      if (!connection || connection.status !== "connected") {
        throw new Error(`${displayName} email provider is not connected.`);
      }

      return sendGoogleEmailMessage({
        accessToken,
        accountEmail: connection.providerAccountEmail,
        message: input,
      });
    },
    async disconnect() {
      await disconnectEmailConnection(ownerUserId, provider);
    },
  };
}
