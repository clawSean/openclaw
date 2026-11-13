// Opt-in, command-scoped cooperation only. Never reads extension frames or vaults.
export function beginIgnoreScope() {
  const body = document.body;
  if (!body) {
    return () => true;
  }
  const key = Symbol.for("openclaw.sean.1password.command-scope");
  let state = globalThis[key];
  if (!state || state.body !== body) {
    const before = body.getAttribute("data-1p-ignore");
    body.setAttribute("data-1p-ignore", "true");
    state = { body, before, count: 0, changed: false };
    state.observer = new MutationObserver(() => {
      state.changed = true;
    });
    state.observer.observe(body, { attributes: true, attributeFilter: ["data-1p-ignore"] });
    globalThis[key] = state;
  }
  state.count++;
  let done = false;
  let expired = false;
  function release() {
    if (done) {
      return !expired;
    }
    done = true;
    clearTimeout(timer);
    state.count--;
    if (state.count === 0) {
      state.changed ||= state.observer.takeRecords().length > 0;
      state.observer.disconnect();
      if (!state.changed && body.getAttribute("data-1p-ignore") === "true") {
        if (state.before === null) {
          body.removeAttribute("data-1p-ignore");
        } else {
          body.setAttribute("data-1p-ignore", state.before);
        }
      }
      if (globalThis[key] === state) {
        delete globalThis[key];
      }
    }
    return !expired;
  }
  // Detached workers cannot run finally. A page-owned deadline prevents a
  // permanently suppressed field; an expired command is never reported success.
  const timer = setTimeout(() => {
    expired = true;
    release();
  }, 60_000);
  return release;
}

export function createOnePasswordCompatibility(isAllowed = () => true) {
  const enabled = new Set();
  return {
    enabled: (tabId) => enabled.has(tabId),
    set: (tabId, value) => (value ? enabled.add(tabId) : enabled.delete(tabId)),
    async run(tabId, sessionId, method, sendCommand, action) {
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
      const scope = await sendCommand("Runtime.evaluate", {
        expression: `(${beginIgnoreScope.toString()})()`,
        returnByValue: false,
      });
      const objectId = scope?.result?.objectId;
      if (scope?.exceptionDetails || !objectId) {
        throw new Error("Could not enable temporary 1Password compatibility; action was not sent.");
      }
      let result;
      let error;
      try {
        result = await action();
      } catch (cause) {
        error = cause;
      }
      try {
        const restored = await sendCommand("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: "function() { return this(); }",
          returnByValue: true,
        });
        if (restored?.exceptionDetails || restored?.result?.value !== true) {
          throw new Error(
            "1Password compatibility scope expired or could not restore; do not replay the action.",
          );
        }
      } catch (cause) {
        error ??= cause;
      } finally {
        await sendCommand("Runtime.releaseObject", { objectId }).catch(() => {});
      }
      if (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      return result;
    },
  };
}
