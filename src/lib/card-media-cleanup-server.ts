import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CleanupCounts = {
  candidates: number; claimed: number; deleted: number; alreadyAbsent: number;
  skippedReferenced: number; failed: number; retried: number; staleInvalid: number;
  deferred: number; sessionsPruned: number;
};
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const pathPattern = new RegExp(`^${uuid}/${uuid}/(profile|logo|banner)/${uuid}\\.(jpg|png|webp)$`);

/** Trusted server/CLI only. Never called by a browser or public cron endpoint.
 * The caller must supply a service client with bounded network timeouts.
 * No signed URLs, object bodies, credentials or personal data are logged.
 */
export async function runCardMediaCleanup(database: SupabaseClient, batchSize = 20, exactAssetId?: string): Promise<CleanupCounts> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error("Invalid cleanup batch size");
  if (exactAssetId !== undefined && (!new RegExp(`^${uuid}$`).test(exactAssetId) || batchSize !== 1)) throw new Error("Invalid exact cleanup asset");
  const counts: CleanupCounts = { candidates: 0, claimed: 0, deleted: 0, alreadyAbsent: 0,
    skippedReferenced: 0, failed: 0, retried: 0, staleInvalid: 0, deferred: 0, sessionsPruned: 0 };
  const started = Date.now();
  async function rpc(name: string, args: Record<string, unknown>) {
    const result = await database.rpc(name, args);
    if (result.error) throw new Error("Cleanup coordination failed");
    return result.data;
  }
  // Exact mode never discovers candidates or falls back to a different asset.
  if (exactAssetId !== undefined) await rpc("check_card_media_cleanup_boundary", {});
  const candidates = exactAssetId !== undefined ? [exactAssetId]
    : await rpc("card_media_cleanup_candidates", { p_limit: batchSize });
  if (!Array.isArray(candidates) || candidates.length > batchSize || candidates.some(id => typeof id !== "string" || !new RegExp(`^${uuid}$`).test(id))) {
    throw new Error("Invalid cleanup candidates");
  }
  counts.candidates = candidates.length;
  const storage = database.storage.from("card-media");
  async function exists(path: string) {
    const { data, error } = await storage.info(path);
    if (!error) {
      if (!data) throw new Error("Invalid Storage metadata");
      return true;
    }
    // Never classify generic 400, authorization, transport or server errors as absence.
    if (("status" in error && Number(error.status) === 404) || error.statusCode === "404" || error.statusCode === "NoSuchKey") return false;
    throw new Error("Storage existence check failed");
  }
  for (const id of candidates) {
    if (Date.now() - started > 25_000) { counts.deferred++; continue; }
    let token: string | undefined;
    const manage = (action: string) => rpc("manage_card_media_cleanup", { p_asset: id, p_action: action, p_token: token ?? null });
    try {
      if (exactAssetId !== undefined) {
        const { data: asset, error } = await database.from("card_media_assets")
          .select("id,state,cleanup_after,cleanup_lease_until").eq("id", exactAssetId).maybeSingle();
        if (error || !asset || asset.id !== exactAssetId
          || !["reserved", "ready", "attached", "cleanup_pending", "deleting", "deleted"].includes(asset.state)) {
          counts.staleInvalid++; continue;
        }
        const due = Date.parse(asset.cleanup_after ?? "");
        const lease = asset.cleanup_lease_until === null ? null : Date.parse(asset.cleanup_lease_until);
        if (!Number.isFinite(due) || (lease !== null && !Number.isFinite(lease))) {
          counts.staleInvalid++; continue;
        }
        if (due > Date.now() || (lease !== null && lease > Date.now())) { counts.deferred++; continue; }
      }
      // Claim rechecks eligibility using database time under the existing locks;
      // the preceding exact-row read is not an authorization decision.
      const claim = await manage("claim");
      if (claim?.status === "referenced") { counts.skippedReferenced++; continue; }
      if (["not_due", "busy", "cleanup_pending"].includes(claim?.status)) { counts.deferred++; continue; }
      if (claim?.status !== "claimed" || typeof claim.token !== "string" || !new RegExp(`^${uuid}$`).test(claim.token)
        || typeof claim.path !== "string" || !pathPattern.test(claim.path) || !claim.path.split("/")[3].startsWith(`${id}.`)) {
        counts.staleInvalid++; continue;
      }
      token = claim.token;
      counts.claimed++;
      if (claim.retried) counts.retried++;
      const present = await exists(claim.path);
      // Recheck references/token immediately before irreversible Storage deletion.
      const check = await manage("check");
      if (check?.status !== "authorized") {
        if (check?.status === "referenced") counts.skippedReferenced++; else counts.staleInvalid++;
        continue;
      }
      if (present) {
        const removed = await storage.remove([claim.path]);
        if (removed.error) throw new Error("Storage deletion failed");
        if (await exists(claim.path)) throw new Error("Storage deletion not confirmed");
      }
      const completed = await manage("complete");
      if (completed?.status !== "deleted") { counts.staleInvalid++; continue; }
      if (present) counts.deleted++; else counts.alreadyAbsent++;
    } catch {
      counts.failed++;
      if (token) { try { await manage("retry"); } catch { /* Lease expiry recovers process/network failure. */ } }
    }
  }
  if (exactAssetId === undefined && Date.now() - started <= 25_000) {
    try { counts.sessionsPruned = await rpc("prune_empty_card_media_sessions", { p_limit: batchSize }); }
    catch { counts.failed++; }
  }
  return counts;
}
