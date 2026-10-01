---
type: Reference
title: Registry and CLI contract
description: State layout, item schema, JSON outputs and exit codes.
tags: [product, registry, cli, api]
---

# Registry and CLI contract

## State layout

```
~/Library/Application Support/dmngr/      0700
  registry.json                            0600   managed items (schemaVersion 1)
  config.json                              0600   optional user preferences
  registry.lock                                   cooperative lock (pid + startedAt, stale detection)
  tmp/                                            downloads and pkg expansion (private, removed after use)
```

`DMNGR_APP_SUPPORT_DIR` overrides the whole state directory (tests rely on this).
Config keys: `destinationAppDir`, `allowHttp`, `allowPrivateNetwork`, `elevate`
(`osascript|sudo|none`), `maxDownloadBytes`, `keepDownloads`. Unknown/future `schemaVersion` fails
with exit code 7 instead of guessing.

## Item schema (schemaVersion 1)

Beyond the obvious identity/version fields, the following carry product meaning:

- `versionEvidence` — where the version came from (see `version-truth-and-updates.md`).
- `weakIdentity` — true when there is no bundle id / package identifier.
- `arch` — raw `lipo` architectures joined by spaces (e.g. `"x86_64 arm64"`); display collapses to
  `universal`.
- `source.kind` — `github-release | direct-url | signed-url | local-file | unknown`, plus
  `repository`, `assetPattern`, `channel` (`stable | prerelease`), `etag`, `lastModified`, `size`,
  `tagComparable` and `pinnedTag` (deliberate version pin; `update` requires `--latest` to leave it).
- `artifact` — `sha256`, `size`, `releaseTag`, `fileName`.
- `receipts` (PKG) — identifier, version, install location, `installed`.
- `observedApps` (PKG) — app bundles the payload declares/installed.
- `verification` — `integrityOk`, `signed`, `notarized`, `teamId`, `overrides[]`.
- `installedAt`, `updatedAt`, `lastCheckedAt`, `lastCheckStatus`, `lastResult`, `previousVersion`.

`lastResult` describes the operation (`installed`, `updated`, `version-refreshed`);
`lastCheckStatus` is the last `check` verdict. Both are informational, never authoritative.

## CLI surface

Commands: `install`, `update` (`<item>`, `--url`, `--all`), `check`, `list`, `info`, `doctor`.
Common flags: `--json`, `--verbose`, `--quiet`, `--yes`, `--dry-run`, `--reinstall`, `--destination`,
`--sha256`, `--keep-download`, `--allow-unverified`, `--allow-http`, `--allow-private-network`,
`--elevate`, `--app <id>`, `--url <url>`. GitHub/channel flags: `--prerelease` (`install`, `update`,
`check`), `--pin` and `--latest` (`install`, `update`), `--allow-arch-mismatch` (`install`, `update`).
`DMNGR_GITHUB_API_URL` redirects API calls (tests/enterprise); asset URLs still come from the API
response and are validated by the network policy.

Behaviour contracts:

- stdout carries only data (text tables or one JSON document per run); progress, warnings and errors
  go to stderr — in `--json` mode errors are a JSON object on stderr.
- `--json` never prompts; `--yes` answers only unambiguous decisions.
- `--dry-run` with a URL performs metadata queries only (declared in the output); with a local file it
  inspects read-only (mounts the DMG) and lists everything the real run would require.
- Item resolution accepts id, display name and aliases; ambiguity is always an error (exit 3) listing
  candidates — never a silent pick.
- `list` and `info` never touch the network; `info` re-reads the installed version from disk and shows
  drift.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success / no-op |
| 1 | internal error |
| 2 | usage (bad flags/arguments/unknown item) |
| 3 | ambiguity or decision required in a non-interactive mode |
| 4 | network |
| 5 | security/integrity (hash, SSRF, signature, missing override) |
| 6 | installation failure (copy, mount, `installer`, refused downgrade) |
| 7 | inconsistent state (unreadable/incompatible registry or config) |

## Report shapes

`install`/`update` JSON: `{schemaVersion, command, action, item, installedPath, installedVersion,
previousVersion, displayName, source{kind,repository,url,tag,asset,channel,pinnedTag},
artifact{fileName,size,sha256},
warnings[], notes[], dryRun}`. `action` is one of `installed`, `updated`, `noop`, `keep-both`,
`planned`.

`check` JSON: `{schemaVersion, refreshed, items[{id, displayName, kind, status, reason, evidence,
installedVersion, localVersion, availableVersion, releaseTag, drift, missingLocal, hint, candidates}]}`.
`reason` is a stable machine-readable code (e.g. `mesma-release`, `recurso-mudou`, `remote-404`,
`origem-nao-rastreavel`, `pinado-em-outra-versao`, `arquitetura-incompativel`).

`install`/`update` reports `source` as `{kind, repository, url, tag, asset, channel, pinnedTag}`, so the
channel and any pin are visible in `--json` output and in the text summary (`· canal stable
[fixado em v1.0.0]`).

`list` JSON: `{schemaVersion, items[{id, displayName, kind, artifactType, installedPath,
installedVersion, buildVersion, versionEvidence, state, weakIdentity, arch, source{…}, lastCheckedAt,
lastResult, previousVersion, updatedAt}]}` with `state` ∈ `ok | missing | unknown-version`.
