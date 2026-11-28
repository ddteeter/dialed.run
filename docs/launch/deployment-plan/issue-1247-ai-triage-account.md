### Stage 1 — invited friends

- **AI tools that read production data run under the LLC** (#1247). The
  agent sessions and any always-on monitors that read Sentry, Workers logs
  or production database rows run in an account in the LLC's name, under
  its provider's commercial terms. Anything still on a personal account is
  disconnected from those sources first, and its memory reset. Then the
  privacy policy's text naming the provider merges (#1248), before the
  texts are published.
- **Sentry's own settings** (#1249): Seer decided (off until then, and not
  started from an agent), and "Prevent Storing of IP Addresses" on, with
  the default data scrubbers. The Sentry DPA stays a stage 2 item (§9,
  `legal-readiness-plan.md` decision 4).
