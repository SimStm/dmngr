---
type: Playbook
title: Registry and state
description: How local state may be read, mutated and reported.
tags: [agents, rules, state]
---

# Registry and state

- State lives in `~/Library/Application Support/dmngr/` (override with `DMNGR_APP_SUPPORT_DIR`, which tests rely on). Directory `0700`, files `0600`.
- The registry holds **only** items dmngr installed. Never add, adopt or silently rewrite pre-existing apps; explicit import is a future command.
- All mutations go through `updateRegistry()`: load under lock → mutate → atomic write (temp + `fsync` + `rename`). No ad-hoc `writeFile` on registry/config paths.
- Persist an item only after the installation was verified as successful. On failure, leave the registry untouched and explain recovery.
- The installed version is re-read from disk on `info`, `check` and `update` — apps can self-update behind dmngr's back. Never trust the stored version when making a decision.
- `schemaVersion` is checked on load: an unknown future version fails with exit code 7 instead of guessing.
- Never store credentials. URLs are stored redacted; tokens are read from the environment only.
- See also: `knowledge/product/registry-and-cli-contract.md`
