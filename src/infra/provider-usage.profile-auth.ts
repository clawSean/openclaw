import {
  ensureAuthProfileStoreWithoutExternalProfiles,
  resolveApiKeyForProfile,
} from "../agents/auth-profiles.js";
import { hasUsableOAuthCredential } from "../agents/auth-profiles/credential-state.js";
import { normalizeProviderId } from "../agents/model-selection.js";
import { getRuntimeConfig, type OpenClawConfig } from "../config/config.js";
import { resolveUsageProviderId } from "./provider-usage.shared.js";
import type { UsageProviderId } from "./provider-usage.types.js";

type ProviderUsageProfileAuth = {
  provider: UsageProviderId;
  token: string;
  authProfileId: string;
  credentialType: "api_key" | "token" | "oauth";
  accountId?: string;
  subscriptionType?: string;
  rateLimitTier?: string;
  email?: string;
};

/** Resolve exactly one stored profile without external overlay, fallback, or OAuth refresh. */
export async function resolveProviderUsageProfileAuth(params: {
  provider: UsageProviderId;
  authProfileId: string;
  agentDir?: string;
  config?: OpenClawConfig;
}): Promise<ProviderUsageProfileAuth | null> {
  const provider = normalizeProviderId(params.provider);
  const authProfileId = params.authProfileId.trim();
  if (!provider || !authProfileId) {
    return null;
  }

  const cfg = params.config ?? getRuntimeConfig();
  const store = ensureAuthProfileStoreWithoutExternalProfiles(params.agentDir, {
    allowKeychainPrompt: false,
    readOnly: true,
    syncExternalCli: false,
  });
  const credential = store.profiles[authProfileId];
  const credentialProvider = credential
    ? (resolveUsageProviderId(credential.provider, { credentialType: credential.type }) ??
      normalizeProviderId(credential.provider))
    : undefined;
  if (!credential || credentialProvider !== provider) {
    return null;
  }
  // The existing resolver only refreshes OAuth when this same predicate is
  // false. Reject first so this read-only path can never enter that branch.
  if (credential.type === "oauth" && !hasUsableOAuthCredential(credential)) {
    return null;
  }

  let resolved: Awaited<ReturnType<typeof resolveApiKeyForProfile>>;
  try {
    resolved = await resolveApiKeyForProfile({
      cfg,
      store,
      profileId: authProfileId,
      agentDir: params.agentDir,
      allowProfileFallback: false,
    });
  } catch {
    return null;
  }
  const resolvedProvider = resolveUsageProviderId(resolved?.provider, {
    credentialType: credential.type,
  });
  if (!resolved || (resolvedProvider ?? normalizeProviderId(resolved.provider)) !== provider) {
    return null;
  }

  const accountId =
    credential.type === "oauth" && typeof credential.accountId === "string"
      ? credential.accountId.trim() || undefined
      : undefined;
  const subscriptionType =
    credential.type === "oauth" && typeof credential.subscriptionType === "string"
      ? credential.subscriptionType.trim() || undefined
      : undefined;
  const rateLimitTier =
    credential.type === "oauth" && typeof credential.rateLimitTier === "string"
      ? credential.rateLimitTier.trim() || undefined
      : undefined;
  const email =
    typeof credential.email === "string" ? credential.email.trim() || undefined : undefined;

  return {
    provider,
    token: resolved.apiKey,
    authProfileId,
    credentialType: credential.type,
    ...(accountId ? { accountId } : {}),
    ...(subscriptionType ? { subscriptionType } : {}),
    ...(rateLimitTier ? { rateLimitTier } : {}),
    ...(email ? { email } : {}),
  };
}
