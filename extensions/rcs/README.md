# RCS OpenClaw channel

Official, separately installed OpenClaw channel for Twilio RCS Business Messaging.

The first release is intentionally RCS-only: dedicated Messaging Service, forced
<code>rcs:+E164</code> delivery, text and media, pairing/allowlists, durable
inbound processing, and persistent monotonic delivery/read observations. It does
not share SMS routes, request SMS fallback, create Content templates, or use
direct RCS sender mode.

See <code>docs/channels/rcs.md</code> in the OpenClaw repository, or the published
docs at <code>https://docs.openclaw.ai/channels/rcs</code>.
