// Fixed phase names and numeric durations only: no IDs, payloads or logs.
export type MediaPhase = "auth" | "template" | "session" | "normalization" | "reservation" | "storage_upload" | "verification" | "ready" | "finalization" | "snapshot" | "card_lookup" | "asset_lookup" | "session_lookup" | "storage_download";
export class MediaRequestTiming {
  private readonly started = Date.now();
  private readonly phases: string[] = [];
  start(name: MediaPhase) {
    const started = Date.now();
    return () => { this.phases.push(`${name};dur=${Math.max(0, Date.now() - started)}`); };
  }
  async measure<T>(name: MediaPhase, operation: () => PromiseLike<T>): Promise<T> {
    const end = this.start(name);
    try { return await operation(); } finally { end(); }
  }
  response(response: Response) {
    response.headers.set("Server-Timing", [...this.phases, `total;dur=${Math.max(0, Date.now() - this.started)}`].join(", "));
    return response;
  }
}
