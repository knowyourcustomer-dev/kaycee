/**
 * status.ts — human descriptions for case statusIds, for the internal
 * debug/verifying view ("53 — Resolving ownership", etc.).
 *
 * The sandbox is being updated in parallel to expose a status description on
 * the case response. `statusDescription()` PREFERS that upstream value when
 * present and falls back to this built-in map so the UI always shows something
 * sensible. Tune the fallback copy freely — it's display-only.
 *
 * Status 3 = Ready (the case has finished building). The 5x band are build
 * sub-states the latency engine moves through; the exact wording is indicative.
 */

const STATUS_DESCRIPTIONS: Record<number, string> = {
  3: "Ready",
  50: "Queued for build",
  51: "Fetching registry record",
  52: "Resolving company details",
  53: "Resolving ownership structure",
  54: "Identifying beneficial owners",
  55: "Building case steps",
  56: "Running screening",
  57: "Finalising case",
};

/**
 * Resolve a human description for a status. Prefers an upstream description
 * carried on the case `common` object (any of a few likely field names), then
 * the built-in map, then the raw statusName, then a generic fallback.
 */
export function statusDescription(
  statusId: number,
  common?: { statusDescription?: string; statusName?: string } | null,
): string {
  const upstream = common?.statusDescription;
  if (upstream && upstream.trim()) return upstream.trim();
  if (STATUS_DESCRIPTIONS[statusId]) return STATUS_DESCRIPTIONS[statusId];
  if (common?.statusName) return common.statusName;
  return statusId === 3 ? "Ready" : "Building";
}

/** "53 — Resolving ownership structure" for the debug stream. */
export function statusLabel(
  statusId: number,
  common?: { statusDescription?: string; statusName?: string } | null,
): string {
  return `${statusId} — ${statusDescription(statusId, common)}`;
}
