export const cardSeedFields = ["full_name", "job_title", "email", "phone", "website", "address", "whatsapp", "linkedin", "instagram", "facebook", "youtube", "booking_link", "custom_url"] as const;
export type CardCreationResult = { staffId: string; status: "created" | "ineligible" | "failed"; message: string; cardId?: string };
export async function mutateAdminCard(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<{ results?: CardCreationResult[] }> {
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new Error("Network error: outcome unknown. Retry the same batch; do not start a new batch."); }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.error) throw new Error(`${result?.code || "RESPONSE_ERROR"}: ${result?.error || "Outcome unknown; retry the same batch."}`);
  return result;
}
