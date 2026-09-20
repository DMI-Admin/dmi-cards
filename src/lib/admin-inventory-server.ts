import "server-only";



import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { emailFromClerkUser, requireAdminAccess } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// Fixed response contracts: never return account/auth/provider internals.
const contactFields = [
  "full_name", "email", "phone", "job_title", "website", "address", "whatsapp",
  "linkedin", "instagram", "facebook", "youtube", "booking_link", "custom_url",
];
const inventoryFields = {
  clients: [
    "id", "full_name", "company_name", "email", "phone", "status",
    "subscription_plan", "account_type", "billing_status", "cards_active", "created_at", "job_title",
  ],
  client_users: ["id", "client_id", "name", "status", "created_at", ...contactFields],
  cards: [
    "id", "client_id", "template_id", "card_name", "name", "slug", "status",
    "is_published", "created_at", ...contactFields, "title", "first_name", "last_name",
    "department", "bio", "company_name", "action_config", "selected_colour",
    "selected_text_colour", "selected_background_mode", "selected_gradient_start",
    "selected_gradient_end", "profile_image_url", "company_logo_url", "company_banner_url",
    "custom_fields", "hidden_fields", "field_visibility", "example_fields",
  ],
} as const;

type Inventory = keyof typeof inventoryFields;

// Only route-owned constants choose tables. No arbitrary table/column/filter API.
export async function readAdminInventory(request: Request, inventory: Inventory) {
  const access = await requireAdminAccess(await auth(), async () =>
    emailFromClerkUser(await currentUser())
  );
  const headers = { "Cache-Control": "private, no-store" };
  if (!access.authorized) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers });
  }

  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId");
  if (
    [...params.keys()].some((key) => key !== "clientId") ||
    (params.has("clientId") && (
      inventory === "clients" || params.getAll("clientId").length !== 1 ||
      !clientId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)
    ))
  ) {
    return NextResponse.json({ error: "Invalid Admin inventory filter." }, { status: 400, headers });
  }

  try {
    const database = createSupabaseAdminClient();
    const items: Record<string, unknown>[] = [];
    // Page through database limits so larger Admin inventories are not truncated.
    const batchSize = 500;
    let offset = 0;
    while (true) {
      // Legacy optional columns differ across installations. Read on the server,
      // then project the allowlist rather than exposing the raw database row.
      let query = database.from(inventory).select("*").order("id", { ascending: true });
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query.range(offset, offset + batchSize - 1);
      if (error) throw new Error("Inventory read failed");
      if (!data?.length) break;
      for (const row of data) {
        items.push(Object.fromEntries(
          inventoryFields[inventory].filter((key) => key in row).map((key) => [key, row[key]])
        ));
      }
      offset += data.length;
    }
    if (inventory !== "client_users") {
      items.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    }
    return NextResponse.json({ items }, { headers });
  } catch {
    return NextResponse.json(
      { error: `Admin ${inventory.replaceAll("_", " ")} could not be loaded. Please retry.` },
      { status: 500, headers }
    );
  }
}

// Identity linkage stays server-side. Account owners and staff memberships may
// represent the same Auth user; never infer identity from names or emails.
