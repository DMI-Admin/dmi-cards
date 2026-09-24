export type AccountLink = { id: string; user_id?: string | null; profile_id?: string | null; account_type?: string | null };
export type StaffLink = AccountLink & { client_id?: string | null };
export type CardLink = { id: string; user_id?: string | null; client_id?: string | null };

// Conflicting UUID links must be repaired explicitly, never guessed from contact data.
export function linkedUser(row: AccountLink): string | null {
  if (row.user_id && row.profile_id && row.user_id !== row.profile_id) return null;
  return row.user_id || row.profile_id || null;
}

export function clientRelationshipCounts(clients: AccountLink[], staff: StaffLink[], cards: CardLink[], realUsers: Set<string>) {
  const verifiedOwner = (row: AccountLink) => {
    const id = linkedUser(row);
    return id && realUsers.has(id) ? id : null;
  };
  const activated = new Set([...clients, ...staff].map(verifiedOwner).filter((id): id is string => Boolean(id)));
  const cardCounts = Object.fromEntries(clients.map(client => [client.id,
    cards.filter(card => client.account_type === "individual"
      ? Boolean(verifiedOwner(client)) && card.user_id === verifiedOwner(client)
      : ["business", "enterprise"].includes(client.account_type || "") && card.client_id === client.id).length,
  ]));
  const staffCards = Object.fromEntries(staff.map(person => [person.id,
    cards.filter(card => Boolean(verifiedOwner(person)) && card.user_id === verifiedOwner(person) && card.client_id === person.client_id).map(card => card.id),
  ]));
  const companies = clients.filter(row => ["business", "enterprise"].includes(row.account_type || ""));
  const companyIds = new Set(companies.map(row => row.id));
  const companyStaff = staff.filter(row => Boolean(row.client_id && companyIds.has(row.client_id)));
  const individualOwners = new Set(clients.filter(row => row.account_type === "individual").map(verifiedOwner).filter(Boolean));
  return {
    areas: {
      individualCards: cards.filter(card => Boolean(card.user_id && individualOwners.has(card.user_id))).length,
      businessCards: cards.filter(card => Boolean(card.client_id && companyIds.has(card.client_id))).length,
      businessPeople: companyStaff.length,
      businessActivatedUsers: new Set([...companies, ...companyStaff].map(verifiedOwner).filter(Boolean)).size,
    },
    summary: {
      totalClients: clients.length,
      individuals: clients.filter(row => row.account_type === "individual").length,
      business: clients.filter(row => row.account_type === "business").length,
      enterprise: clients.filter(row => row.account_type === "enterprise").length,
      activatedUsers: activated.size,
      unlinkedStaff: staff.filter(row => !verifiedOwner(row)).length,
      cards: cards.length,
    },
    cardCounts, staffCards,
  };
}
export type ClientRelationshipCounts = ReturnType<typeof clientRelationshipCounts>;

export async function mutateAdminClient(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, token?: string): Promise<{ id?: string }> {
  const response = await fetch(path, {
    method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || "The operation was not confirmed. Refresh before retrying.");
  return { ...(typeof result.id === "string" ? { id: result.id } : {}) };
}
export async function getAdminClientCounts(): Promise<ClientRelationshipCounts> {
  const response = await fetch("/api/admin/clients/summary", { credentials: "same-origin", cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.summary) throw new Error("Could not verify account/card counts. Please retry.");
  return result;
}
