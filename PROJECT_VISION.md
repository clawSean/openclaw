# Personal Browser Extension Compatibility

## Objective

Deliver two independently loadable browser-extension builds derived from the
OpenClaw `v2026.8.2` browser extension:

1. A native-faithful compatibility build that preserves upstream OpenClaw
   product, UX, access, and security behavior while making the shipped feature
   set dependable in Arc and Dia on macOS.
2. A separate personal hardened build that preserves the same UX and automation
   surface while addressing only indisputably critical credential-exposure
   risks, including best-effort restriction of direct cookie-jar extraction.

Both builds must be reproducible, auditable, and E2E-proven through the actual
browser → extension → relay → OpenClaw control path. Tailscale is the intended
remote transport; the extension must not embed private endpoints or credentials
in published source.

## Non-goals

- Redesigning the upstream extension UX or consent model during the
  native-faithful phase.
- Adding policy friction that an informed single user can reasonably manage.
- Claiming zero-secret isolation while arbitrary page JavaScript remains
  available.
- Editing the globally installed OpenClaw package as the canonical source.

## Acceptance

- Upstream feature inventory and browser-compatibility matrix are explicit.
- Arc and Dia pass connection, discovery, navigation, snapshot, screenshot,
  click, type, tab lifecycle, access-mode, reconnect, and negative-path checks.
- Every compatibility change has a focused regression and leaves Chromium
  behavior intact.
- The hardened variant separately proves direct cookie APIs and raw
  cookie/auth protocol material are blocked without breaking ordinary page
  automation.
- Deliverables contain no relay credential, private URL, or personal browser
  data.
