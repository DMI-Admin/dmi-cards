import "server-only";

import { createClient, type User } from "@supabase/supabase-js";
import {
  defaultClientPlan,
  normalizeDmiPlan,
  type DmiEntitlementSet,
  type DmiFeature,
  type DmiPlan,
} from "@/lib/entitlements";
import { ApiRouteError } from "@/lib/api/responses";
import { entitlementsForTrustedBillingState } from "@/lib/stripe/billing-state";

export type ApiClientProfile = {
  id: string;
  title: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
};

export type ApiClientContext = {
  userId: string;
  email: string | null;
  profile: ApiClientProfile | null;
  plan: DmiPlan;
  planSource: "stripe_billing" | "temporary_free_cap";
  entitlements: DmiEntitlementSet;
};

type ApiProfileRow = {
  id?: string | null;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  subscription_plan?: string | null;
  plan?: string | null;
};

type ApiBillingSubscriptionRow = {
  stripe_subscription_status?: string | null;
  stripe_price_id?: string | null;
  updated_at?: string | null;
};

export async function requireApiClient(request: Request): Promise<ApiClientContext> {
  const accessToken = bearerTokenFromRequest(request);

  if (!accessToken) {
    throw new ApiRouteError(
      401,
      "UNAUTHENTICATED",
      "Authentication is required."
    );
  }

  const supabase = createApiSupabaseClient(accessToken);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    throw new ApiRouteError(
      401,
      "UNAUTHENTICATED",
      "Authentication is required."
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id, title, first_name, last_name, full_name, email, subscription_plan, plan"
    )
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[DMI api] profile lookup failed", {
      userId: user.id,
      code: profileError.code,
    });

    throw new ApiRouteError(
      500,
      "INTERNAL_ERROR",
      "Could not load the authenticated client."
    );
  }

  const profileRow = profile as ApiProfileRow | null;
  const billingState = await resolveTrustedApiBillingState(supabase, user.id);

  warnIfProfilePlanWouldGrantPaidAccess(profileRow, billingState.plan);

  return {
    userId: user.id,
    email: user.email || null,
    profile: profileRow ? toApiClientProfile(profileRow, user) : null,
    plan: billingState.plan,
    planSource: billingState.source,
    entitlements: billingState.entitlements,
  };
}

export function requireApiClientFeature(
  client: ApiClientContext,
  feature: DmiFeature
) {
  const access = client.entitlements[feature];

  if (!access?.allowed) {
    throw new ApiRouteError(
      403,
      "FORBIDDEN",
      "Your plan does not include this feature."
    );
  }

  return access;
}

function createApiSupabaseClient(accessToken: string) {
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

function bearerTokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || "";
}

async function resolveTrustedApiBillingState(
  supabase: ReturnType<typeof createApiSupabaseClient>,
  userId: string
) {
  const { data, error } = await supabase
    .from("billing_subscriptions")
    .select("stripe_subscription_status, stripe_price_id, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[DMI api] billing subscription lookup failed", {
      userId,
      code: error.code,
    });

    throw new ApiRouteError(
      500,
      "INTERNAL_ERROR",
      "Could not load the authenticated client billing state."
    );
  }

  const rows = (data || []) as ApiBillingSubscriptionRow[];
  const paidBillingState = rows
    .map((row) =>
      entitlementsForTrustedBillingState({
        status: row.stripe_subscription_status,
        priceId: row.stripe_price_id,
      })
    )
    .find((state) => state.plan !== defaultClientPlan);

  return (
    paidBillingState ||
    entitlementsForTrustedBillingState({
      status: rows[0]?.stripe_subscription_status,
      priceId: rows[0]?.stripe_price_id,
    })
  );
}

function warnIfProfilePlanWouldGrantPaidAccess(
  profile: ApiProfileRow | null,
  trustedBillingPlan: DmiPlan
) {
  const profilePlan = normalizeDmiPlan(profile?.subscription_plan || profile?.plan);

  if (profilePlan !== "free" && trustedBillingPlan === defaultClientPlan) {
    console.warn("[DMI api] profile plan ignored for entitlement grant", {
      reason: "PROFILE_PLAN_USER_WRITABLE",
    });
  }
}

function toApiClientProfile(
  profile: ApiProfileRow,
  user: Pick<User, "id" | "email">
): ApiClientProfile {
  return {
    id: profile.id || user.id,
    title: profile.title || null,
    first_name: profile.first_name || null,
    last_name: profile.last_name || null,
    full_name: profile.full_name || null,
    email: profile.email || user.email || null,
  };
}
