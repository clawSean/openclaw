import type { ProviderUsageSnapshot, UsageSummary } from "./provider-usage.types.js";

/** Core-internal exact-profile usage request. */
export type ProviderUsageProfileReadParams = {
  providerId: string;
  authProfileId: string;
  /** Identity-bearing fields are intentionally unavailable on this read-only seam. */
  includeIdentity?: false;
  /** Credential refresh is intentionally unavailable on this read-only seam. */
  refreshCredentials?: false;
  timeoutMs?: number;
};

/** Token-free usage snapshot bound to the exact auth profile that produced it. */
export type ProviderUsageProfileSnapshot = Omit<ProviderUsageSnapshot, "accountEmail"> & {
  authProfileId: string;
  capturedAt: number;
};

/** Core-internal summary enriched with exact-profile snapshots. */
export type ProviderUsageSummary = UsageSummary & {
  profiles?: ProviderUsageProfileSnapshot[];
};
