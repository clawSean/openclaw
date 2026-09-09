export function pairingStatusText(status) {
  return status?.paired === true ? "Saved" : "Not paired";
}

export function relayStatusText(status) {
  if (status?.paired !== true) {
    return "Not configured";
  }
  if (status.retiredCopilotCustodyBlocked === true) {
    return "Automation paused";
  }
  if (status.scopeCleanupPending === true) {
    return "Disconnected during tab handoff";
  }
  if (status.connectionEnabled !== true) {
    return "Disconnected";
  }
  if (status.state === "on") {
    return "Connected to Sean";
  }
  if (status.state === "connecting") {
    return "Connecting to Sean…";
  }
  return "Unavailable";
}

export function accessStatusText(status) {
  if (status?.paired !== true) {
    return "No browser access";
  }
  if (status.retiredCopilotCustodyBlocked === true) {
    return "Automation paused for recovery";
  }
  if (status.scopeCleanupPending === true) {
    return "Access paused during tab handoff";
  }
  const count = Number.isInteger(status?.accessibleTabCount) ? status.accessibleTabCount : 0;
  if (status.connectionEnabled !== true) {
    return status?.accessMode === "selected"
      ? "Access paused; selected-tab mode kept"
      : "Browser access paused";
  }
  if (status?.accessMode === "selected") {
    if (count === 0) {
      return "No tabs selected";
    }
    return `${count} ${count === 1 ? "tab" : "tabs"} selected for Sean`;
  }
  return `${count} eligible ${count === 1 ? "tab" : "tabs"} available to Sean`;
}
