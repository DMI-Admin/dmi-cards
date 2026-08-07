import { supabase } from "@/lib/supabase";
import {
  buildCardSlugBase,
  buildSupabaseCardPayload,
  cardSlugCandidate,
  isDuplicateCardSlugError,
  missingCardColumnFromError,
  slugify,
  type SharedClientCard,
  type SupabaseCardRow,
} from "@/lib/services/card-payload";

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
    .order("updated_at", { ascending: false });
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
  isPublishing = false,
}: {
  card: SharedClientCard;
  userId: string;
  mode: CardWriteMode;
  isPublishing?: boolean;
}): Promise<CardWriteResult> {
  const shouldUpdate = mode === "edit" && !card.id.startsWith("card-");
  const currentCardId = shouldUpdate ? card.id : null;
  const slugBase = buildCardSlugBase(card);
  const slug = await ensureUniqueCardSlug(slugBase, currentCardId);
  const payload = buildSupabaseCardPayload(
    {
      ...card,
      slug,
      public_url: `/u/${slug}`,
    },
    userId
  );

  if (isPublishing) {
    console.log("[DMI publish] publish payload", {
      shouldUpdate,
      cardId: card.id,
      payload,
    });
  }

  return writeCardPayload({
    cardId: card.id,
    userId,
    payload,
    shouldUpdate,
    slugBase,
    currentCardId,
  });
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
  return supabase
    .from("cards")
    .delete()
    .eq("id", cardId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
}

export async function writeCardPayload({
  cardId,
  userId,
  payload,
  shouldUpdate,
  slugBase,
  currentCardId,
}: {
  cardId: string;
  userId: string;
  payload: Record<string, unknown>;
  shouldUpdate: boolean;
  slugBase: string;
  currentCardId: string | null;
}): Promise<CardWriteResult> {
  const timestamp = new Date().toISOString();
  let nextPayload: Record<string, unknown> = shouldUpdate
    ? { ...payload, updated_at: timestamp }
    : { ...payload, created_at: timestamp, updated_at: timestamp };
  const attemptedSlugs = new Set<string>();
  const writePayload = async () =>
    shouldUpdate
      ? await supabase
          .from("cards")
          .update(nextPayload)
          .eq("id", cardId)
          .eq("user_id", userId)
          .select("*")
          .single()
      : await supabase.from("cards").insert([nextPayload]).select("*").single();

  let result = await writePayload();

  while (result.error) {
    if (isDuplicateCardSlugError(result.error)) {
      const attemptedSlug =
        typeof nextPayload.slug === "string" ? nextPayload.slug : "";

      if (attemptedSlug) {
        attemptedSlugs.add(attemptedSlug);
      }

      const nextSlug = await nextUniqueCardSlugCandidate(
        slugBase,
        currentCardId,
        attemptedSlugs
      );

      if (!nextSlug) {
        break;
      }

      nextPayload = {
        ...nextPayload,
        slug: nextSlug,
      };
      attemptedSlugs.add(nextSlug);
      result = await writePayload();
      continue;
    }

    const missingColumn = missingCardColumnFromError(result.error);

    if (!missingColumn || !(missingColumn in nextPayload)) {
      break;
    }

    const { [missingColumn]: _removed, ...reducedPayload } = nextPayload;
    void _removed;
    nextPayload = reducedPayload;
    result = await writePayload();
  }

  if (result.error) {
    return { data: null, error: result.error };
  }

  return { data: result.data as SupabaseCardRow, error: null };
}

export async function ensureUniqueCardSlug(
  baseSlug: string,
  currentCardId: string | null
) {
  const cleanBase = slugify(baseSlug) || "digital-card";
  let suffix = 1;

  while (suffix <= 100) {
    const candidate = cardSlugCandidate(cleanBase, suffix);

    if (!(await cardSlugExists(candidate, currentCardId))) {
      return candidate;
    }

    suffix += 1;
  }

  return `${cleanBase}-${Date.now().toString(36)}`;
}

async function nextUniqueCardSlugCandidate(
  baseSlug: string,
  currentCardId: string | null,
  attemptedSlugs: Set<string>
) {
  const cleanBase = slugify(baseSlug) || "digital-card";

  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const candidate = cardSlugCandidate(cleanBase, suffix);

    if (attemptedSlugs.has(candidate)) {
      continue;
    }

    if (!(await cardSlugExists(candidate, currentCardId))) {
      return candidate;
    }
  }

  const timestampedCandidate = `${cleanBase}-${Date.now().toString(36)}`;
  return attemptedSlugs.has(timestampedCandidate) ? null : timestampedCandidate;
}

async function cardSlugExists(slug: string, currentCardId: string | null) {
  let query = supabase.from("cards").select("id").eq("slug", slug).limit(1);

  if (currentCardId) {
    query = query.neq("id", currentCardId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("Slug uniqueness check failed", error);
    return false;
  }

  return Boolean(data);
}
