type AdminInventory = "clients" | "client-users" | "cards";

export async function getAdminInventory<T>(inventory: AdminInventory, clientId?: string): Promise<T[]> {
  const query = clientId ? `?${new URLSearchParams({ clientId })}` : "";
  const response = await fetch(`/api/admin/${inventory}${query}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(result?.items)) {
    throw new Error(
      typeof result?.error === "string" ? result.error : `Admin ${inventory} could not be loaded. Please retry.`
    );
  }
  return result.items;
}
