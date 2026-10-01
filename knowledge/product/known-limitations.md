---
type: Reference
title: Known limitations
description: Deliberate boundaries of the current implementation.
tags: [product, limitations, roadmap]
---

# Known limitations

Current, deliberate boundaries — each one has a reason, not an oversight:

- **Pre-download architecture detection is name-based.** The API does not expose architectures, so
  dmngr infers from the asset name and confirms with `lipo` after the download (before installing).
  Names without an architecture token are treated as unknown, never as a mismatch.
- **PKG payloads are not architecture-checked** (only the asset name from the API); the payload would
  need to be extracted and inspected.
- **GitHub Enterprise hosts are not recognized** as link forms; API base redirection is available via
  `DMNGR_GITHUB_API_URL`.
- **ZIP is not supported.** Plash, Ice and AltTab publish `.zip` assets; dmngr refuses them with a
  hint to use the vendor's DMG/PKG. ZIP→`.app` is on the roadmap.
- **PKG is not transactional.** `installer` scripts run as root and can change services, files and
  settings outside `/Applications`; nothing is rolled back. Accepting this is an explicit override.
- **Encrypted DMGs are rejected.**
- **No `import` of pre-existing apps.** Only items installed by dmngr appear in the registry.
- **Weak-identity apps** (no `CFBundleIdentifier`) are registered but never updated automatically.
- **No generic rollback / no uninstall.** Restoring a replaced `.app` happens only within the same
  installation attempt (staging → backup → rename).
- **Downgrades are refused** (no `--allow-downgrade` yet).
- **`update --all` requires an interactive confirmation** (aggregated) and skips items whose update
  cannot be proven.
- **Sparkle-feed apps** stay `unknown` in `check`; they are updated explicitly with `--url`.
- **Single-user state.** `sudo dmngr` is explicitly not supported; the registry must stay per-user.
- **`check` exits 0** regardless of statuses — scripting reads the JSON. There is no `--exit-code`
  flag yet.
- **TeamID/notarization strings come from system tools** and may vary between macOS versions; tests
  therefore assert on the two-tier outcome (integrity vs Gatekeeper acceptance), not on raw text.

Related: `knowledge/product/version-truth-and-updates.md`,
`knowledge/product/registry-and-cli-contract.md`.
