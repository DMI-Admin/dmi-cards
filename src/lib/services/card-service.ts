import { saveCardWithMedia } from "@/lib/client-card-media";
import { supabase } from "@/lib/supabase";
import type { SharedClientCard, SupabaseCardRow } from "@/lib/services/card-payload";

export type CardWriteMode = "create" | "edit";
export type CardWriteResult = {
  data: SupabaseCardRow | null;
  error: { code?: string; message?: string } | null;
};

export async function listCardsForUser(userId: string) {
  return supabase
    .from("cards")
    .select("*")
    .eq("user_id", userId)
    .order("card_slot", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
}

export async function getCardForUser(cardId: string, userId: string) {
  return supabase
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .eq("user_id", userId)
    .maybeSingle();
}

export async function getPublishedCardForUser(userId: string) {
  return supabase
    .from("cards")
    .select(
      "id, card_name, slug, full_name, first_name, last_name, company_name, job_title, profile_image_url"
    )
    .eq("user_id", userId)
    .or("status.eq.published,is_published.eq.true")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function saveClientCard({
  card,
  userId,
  mode,
  useMediaFinalization = true,
}: {
  card: SharedClientCard;
  userId: string;
  mode: CardWriteMode;
  isPublishing?: boolean;
  useMediaFinalization?: boolean;
}): Promise<CardWriteResult> {
  void userId;
  if (useMediaFinalization) {
    try { return { data: await saveCardWithMedia(card, mode), error: null }; }
    catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : "Could not save card. Retry the same save." } }; }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return {
      data: null,
      error: { code: "UNAUTHENTICATED", message: "Please sign in to save your card." },
    };
  }

  const response = await fetch("/api/client/cards", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ card, mode }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = result?.error || {};

    return {
      data: null,
      error: {
        code: typeof error.code === "string" ? error.code : String(response.status),
        message:
          typeof error.message === "string"
            ? error.message
            : "Failed to save card. Please try again.",
      },
    };
  }

  return { data: (result?.data?.card || null) as SupabaseCardRow | null, error: null };
}

export async function createCard({
  card,
  userId,
  isPublishing = false,
}: {
  card: SharedClientCard;
  userId: string;
  isPublishing?: boolean;
}) {
  return saveClientCard({ card, userId, mode: "create", isPublishing });
}

export async function updateCard({
  card,
  userId,
  isPublishing = false,
}: {
  card: SharedClientCard;
  userId: string;
  isPublishing?: boolean;
}) {
  return saveClientCard({ card, userId, mode: "edit", isPublishing });
}

export async function publishCard({
  card,
  userId,
  mode,
}: {
  card: SharedClientCard;
  userId: string;
  mode: CardWriteMode;
}) {
  return saveClientCard({
    card: { ...card, status: "published" },
    userId,
    mode,
    isPublishing: true,
  });
}

export async function unpublishCard({
  card,
  userId,
  mode,
}: {
  card: SharedClientCard;
  userId: string;
  mode: CardWriteMode;
}) {
  return saveClientCard({
    card: { ...card, status: "unpublished" },
    userId,
    mode,
  });
}

export async function deleteCardForUser(cardId: string, userId: string) {
  // Kept for caller compatibility; ownership is resolved exclusively by the API.
  void userId;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { data: null, error: { code: "UNAUTHENTICATED", message: "Please sign in to delete your card." } };
  try {
    const response = await fetch(`/api/client/cards/${encodeURIComponent(cardId)}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { data: null, error: {
      code: result?.error?.code || String(response.status),
      message: result?.error?.message || "Could not delete card. Please retry.",
    } };
    return { data: result.data.deleted as { id: string }, error: null };
  } catch {
    return { data: null, error: { code: "NETWORK_ERROR", message: "Could not delete card. Check your connection and retry." } };
  }
}
