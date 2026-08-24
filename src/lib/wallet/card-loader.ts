import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type WalletCardRow = {
  id: string;
  slug: string | null;
  card_name: string | null;
  title: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  company_name: string | null;
  job_title: string | null;
  profile_image_url: string | null;
  selected_colour: string | null;
  updated_at: string | null;
  status: string | null;
  is_published: boolean | null;
};

export type WalletCardForPass = {
  id: string;
  slug: string;
  displayName: string;
  companyName: string;
  jobTitle: string;
  profileImageUrl: string;
  backgroundColor: string;
  updatedAt: string;
};

export class WalletRouteError extends Error {
  status: 401 | 404 | 409;
  code: string;

  constructor(status: 401 | 404 | 409, code: string, message: string) {
    super(message);
    this.name = "WalletRouteError";
    this.status = status;
    this.code = code;
  }
}

const cardIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function loadWalletCardForRequest(request: Request, cardId: string) {
  if (!cardIdPattern.test(cardId)) {
    throw new WalletRouteError(404, "CARD_NOT_FOUND", "Wallet card not found.");
  }

  const accessToken = bearerTokenFromRequest(request);

  if (!accessToken) {
    throw new WalletRouteError(
      401,
      "CLIENT_AUTH_REQUIRED",
      "Please sign in to manage Wallet."
    );
  }

  const supabase = createWalletSupabaseClient(accessToken);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    throw new WalletRouteError(
      401,
      "CLIENT_AUTH_REQUIRED",
      "Please sign in to manage Wallet."
    );
  }

  const { data, error } = await supabase
    .from("cards")
    .select(
      "id, slug, card_name, title, first_name, last_name, full_name, company_name, job_title, profile_image_url, selected_colour, updated_at, status, is_published"
    )
    .eq("id", cardId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) {
    throw new WalletRouteError(404, "CARD_NOT_FOUND", "Wallet card not found.");
  }

  const card = data as WalletCardRow;

  if (!(card.status === "published" || card.is_published)) {
    throw new WalletRouteError(
      409,
      "CARD_NOT_PUBLISHED",
      "Publish this card before adding it to Apple Wallet."
    );
  }

  if (!card.slug) {
    throw new WalletRouteError(409, "CARD_NOT_PUBLISHED", "Published card is missing a public URL.");
  }

  return normalizeWalletCardForPass(card);
}

export async function loadPublishedWalletCardById(cardId: string) {
  if (!cardIdPattern.test(cardId)) {
    throw new WalletRouteError(404, "CARD_NOT_FOUND", "Wallet card not found.");
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("cards")
    .select(
      "id, slug, card_name, title, first_name, last_name, full_name, company_name, job_title, profile_image_url, selected_colour, updated_at, status, is_published"
    )
    .eq("id", cardId)
    .maybeSingle();

  if (error || !data) {
    throw new WalletRouteError(404, "CARD_NOT_FOUND", "Wallet card not found.");
  }

  const card = data as WalletCardRow;

  if (!(card.status === "published" || card.is_published) || !card.slug) {
    throw new WalletRouteError(
      409,
      "CARD_NOT_PUBLISHED",
      "Publish this card before adding it to Apple Wallet."
    );
  }

  return normalizeWalletCardForPass(card);
}

function bearerTokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || "";
}

function createWalletSupabaseClient(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase client environment is not configured.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

function normalizeWalletCardForPass(card: WalletCardRow): WalletCardForPass {
  const displayName =
    card.full_name ||
    [card.title, card.first_name, card.last_name].filter(Boolean).join(" ") ||
    card.card_name ||
    "DMI Card";

  return {
    id: card.id,
    slug: card.slug || "",
    displayName,
    companyName: card.company_name || "",
    jobTitle: card.job_title || "",
    profileImageUrl: card.profile_image_url || "",
    backgroundColor: safeHexColor(card.selected_colour) || "",
    updatedAt: card.updated_at || "",
  };
}

function safeHexColor(color: string | null) {
  const value = color?.trim() || "";

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : "";
}
