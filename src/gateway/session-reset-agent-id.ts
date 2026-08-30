import { resolveAmbientOwnerAgentId } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { normalizeAgentId } from "../routing/session-key.js";

export function resolveLifecycleAgentId(cfg: OpenClawConfig, agentId?: string): string {
  return normalizeAgentId(agentId ?? resolveAmbientOwnerAgentId(cfg));
}
