// Explicit shared-document cooperation. Never reads extension frames or vaults.
export function beginIgnoreScope() {
  const body = document.body;
  if (!body) {
    throw new Error("The page has no body yet.");
  }
  const key = Symbol.for("openclaw.sean.1password.document-scope");
  const prior = globalThis[key];
  if (prior?.body === body && prior.lease("renew")) {
    return prior.lease;
  }
  const before = body.getAttribute("data-1p-ignore");
  body.setAttribute("data-1p-ignore", "true");
  let changed = false;
  let done = false;
  let timer;
  const observer = new MutationObserver(() => {
    changed = true;
  });
  observer.observe(body, { attributes: true, attributeFilter: ["data-1p-ignore"] });
  function lease(operation) {
    if (done) {
      return false;
    }
    changed ||= observer.takeRecords().length > 0;
    clearTimeout(timer);
    if (operation === "renew" && !changed && document.body === body) {
      timer = setTimeout(() => lease("release"), 60_000);
      return true;
    }
    done = true;
    observer.disconnect();
    globalThis.removeEventListener("pagehide", onPageHide);
    if (!changed && body.getAttribute("data-1p-ignore") === "true") {
      if (before === null) {
        body.removeAttribute("data-1p-ignore");
      } else {
        body.setAttribute("data-1p-ignore", before);
      }
    }
    if (globalThis[key]?.lease === lease) {
      delete globalThis[key];
    }
    return operation === "release";
  }
  const onPageHide = () => lease("release");
  globalThis.addEventListener("pagehide", onPageHide, { once: true });
  globalThis[key] = { body, lease };
  lease("renew");
  return lease;
}

const callLease = (sendCommand, objectId, operation) =>
  sendCommand("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: "function(operation) { return this(operation); }",
    arguments: [{ value: operation }],
    returnByValue: true,
  });

export function createOnePasswordCompatibility(isAllowed = () => true) {
  const enabled = new Set();
  const scopes = new Map();
  const stopping = new Map();
  async function cleanup(tabId, cleanupCommand) {
    enabled.delete(tabId);
    const scope = scopes.get(tabId);
    if (!scope) {
      return;
    }
    scopes.delete(tabId);
    clearTimeout(scope.timer);
    await scope.pending?.catch(() => {});
    if (!scope.objectId) {
      return;
    }
    const dispatch = cleanupCommand ?? scope.sendCommand;
    try {
      await callLease(dispatch, scope.objectId, "release");
    } finally {
      await dispatch("Runtime.releaseObject", { objectId: scope.objectId }).catch(() => {});
    }
  }
  function stop(tabId, cleanupCommand) {
    const existing = stopping.get(tabId);
    if (existing) {
      return existing;
    }
    const pending = cleanup(tabId, cleanupCommand);
    stopping.set(tabId, pending);
    void pending
      .finally(() => {
        if (stopping.get(tabId) === pending) {
          stopping.delete(tabId);
        }
      })
      .catch(() => {});
    return pending;
  }
  async function ensure(tabId, sendCommand, checkAccess) {
    let scope = scopes.get(tabId);
    if (scope) {
      await scope.pending;
      const result = await callLease(sendCommand, scope.objectId, "renew");
      if (result?.exceptionDetails || result?.result?.value !== true) {
        await stop(tabId).catch(() => {});
        throw new Error(
          "The page changed or compatibility expired; action was not sent. Enable it again to retry deliberately.",
        );
      }
      return;
    }
    scope = { sendCommand, checkAccess };
    scopes.set(tabId, scope);
    async function renew() {
      if (scopes.get(tabId) !== scope) {
        return;
      }
      try {
        if (!isAllowed() || !enabled.has(tabId)) {
          throw new Error("Compatibility scope ended");
        }
        await checkAccess();
        const result = await callLease(sendCommand, scope.objectId, "renew");
        if (result?.exceptionDetails || result?.result?.value !== true) {
          throw new Error("The page changed or the compatibility lease expired");
        }
        if (scopes.get(tabId) === scope) {
          scope.timer = setTimeout(renew, 10_000);
        }
      } catch {
        await stop(tabId).catch(() => {});
      }
    }
    scope.pending = (async () => {
      const result = await sendCommand("Runtime.evaluate", {
        expression: `(${beginIgnoreScope.toString()})()`,
        returnByValue: false,
      });
      if (result?.exceptionDetails || !result?.result?.objectId) {
        throw new Error("Could not pause 1Password suggestions; action was not sent.");
      }
      scope.objectId = result.result.objectId;
      if (scopes.get(tabId) !== scope || !enabled.has(tabId)) {
        throw new Error("Compatibility was disabled before the action; action was not sent.");
      }
      scope.timer = setTimeout(renew, 10_000);
    })();
    try {
      await scope.pending;
    } catch (error) {
      // stop() may be awaiting this promise; do not await it recursively here.
      if (scopes.get(tabId) === scope) {
        scopes.delete(tabId);
        enabled.delete(tabId);
      }
      throw error;
    }
  }
  return {
    enabled: (tabId) => enabled.has(tabId),
    set: async (tabId, value) => {
      if (!value) {
        await stop(tabId);
        return;
      }
      await stopping.get(tabId);
      enabled.add(tabId);
    },
    disarm: (tabId) => enabled.delete(tabId),
    disarmAll: () => enabled.clear(),
    stop,
    stopAll: () =>
      Promise.allSettled([...new Set([...enabled, ...scopes.keys()])].map((tabId) => stop(tabId))),
    async run(tabId, sessionId, method, sendCommand, action, checkAccess = async () => {}) {
      if (
        !isAllowed() ||
        !enabled.has(tabId) ||
        sessionId ||
        !(
          method.startsWith("Input.") ||
          method === "DOM.focus" ||
          method === "Runtime.evaluate" ||
          method === "Runtime.callFunctionOn"
        )
      ) {
        return action();
      }
      await ensure(tabId, sendCommand, checkAccess);
      await checkAccess();
      if (!enabled.has(tabId)) {
        throw new Error("Compatibility ended before action; action was not sent.");
      }
      return action();
    },
  };
}
