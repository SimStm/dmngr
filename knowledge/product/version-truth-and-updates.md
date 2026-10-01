---
type: Reference
title: Version truth and update detection
description: Where versions come from, when they may be compared, and what check may claim.
tags: [product, versions, check, update]
---

# Version truth and update detection

Implemented in `src/core/versioning.ts` and `src/core/ops/decide.ts`.

## GitHub links and release channels

Any GitHub link is resolved through the API before installing: `github.com/<o>/<r>` (repo page),
`/releases`, `/releases/latest`, `/releases/tag/<tag>`, both `/download/` forms and the
`api.github.com` equivalents. Sections that never point at an installable file (`/tree/…`,
`/issues/…`, `/archive/…`, `/releases/expanded_assets/…`) are refused with guidance.

| Channel | Head release |
| --- | --- |
| `stable` (default) | GitHub `releases/latest` — published, non-prerelease |
| `prerelease` (`--prerelease`) | newest non-draft release by publication date, stable or prerelease |

`--prerelease` deliberately includes stable releases: opting into prereleases can never produce a
downgrade relative to a newer stable release. Drafts are always skipped.

**Pinned versus head.** When a URL pins a tag that is not the channel head, dmngr always asks which
one to install. Non-interactive runs (`--yes`, `--json`, no TTY) exit with code 3 and explain
`--pin` (keep the URL's version) and `--latest` (take the channel head). When the tags match, nothing
is asked. Dry-run reports both without asking.

**Pins are recorded.** Choosing the URL's version (or passing `--pin`) stores `source.pinnedTag`.
`check` then reports `pinado-em-outra-versao` instead of claiming an update, and `update <item>`
refuses to leave the pin: `dmngr update <id> --latest` follows the channel and clears the pin on
success. The selected channel is stored in `source.channel` and reused by `check`/`update`;
`--prerelease` overrides it for a single run.

## Architecture validation

Two passes, both against the local machine (`machineArch()`, `process.arch`):

1. **Before download**, from the asset name: `arm64|aarch64|apple-silicon|silicon` vs
   `x64|x86_64|amd64|intel`; `universal|univ` or no token = unknown. Assets whose names indicate
   Windows/Linux are never selected, and a release without macOS assets fails with the asset list.
2. **After download**, from the real bundle architectures (`lipo -archs`), before anything installed is
   touched.

| Situation | Result |
| --- | --- |
| same architecture, universal, or unknown | proceeds (unknown is confirmed in pass 2) |
| x64 asset/app on arm64 | needs Rosetta 2: interactive confirmation or `--allow-arch-mismatch`; recorded as `arch-mismatch` |
| arm64 asset/app on x64 | blocked with no override (exit 6) — it cannot run |
| Rosetta 2 unavailable | blocked with the install hint |

A release that only publishes a build for the other architecture is reported with its candidates
(`install.md` JSON `details.assetsIncompativeis`) instead of being installed.

## Version evidence

The registry records `versionEvidence` for every item:

| Evidence | Meaning |
| --- | --- |
| `bundle-info-plist` | `CFBundleShortVersionString` read from the installed `.app` |
| `pkg-receipt` | `pkg-version` read back from `pkgutil --pkg-info-plist` |
| `distribution-xml` | version declared by the package `Distribution`/`PackageInfo` |
| `release-tag` | version derived from a GitHub release tag with a validated mapping |
| `user-provided` / `unknown` | no trustworthy source (e.g. PKG that left no receipt) |

`installedVersion: null` is a valid state and is displayed as "versão desconhecida".

## Comparison rules

- Versions are compared with `compareVersions()`, which handles dotted numeric segments,
  zero-fill (`1.2` == `1.2.0`), pre-releases (`1.0.0-beta` < `1.0.0`) and returns `null` when either
  side is not a version at all.
- **Never compare across universes.** A release tag is only comparable with an app version when
  `source.tagComparable` was recorded at installation time — which happens only if the normalized tag
  equals the version read from the artifact. If the installed version later changes (a built-in
  auto-updater), the mapping is considered stale and checks fall back to `unknown`.
- ETag / Last-Modified / content length are *change indicators*, never versions. Equal values may
  support `up_to_date` (evidence `http`); different values only produce `unknown` with a hint to run
  `update`.

## `check` statuses

| Status | When |
| --- | --- |
| `update_available` | GitHub tag newer than the installed version **with a valid mapping** |
| `up_to_date` | same release as installed; or equal mapped tag; or unchanged HTTP metadata |
| `unknown` | no mapping/no comparable tag, ambiguous assets, changed HTTP resource, untrackable source (`local-file`, `signed-url`), pinned elsewhere (`pinado-em-outra-versao`), no build for this machine (`arquitetura-incompativel`) |
| `not_found` | release without installable assets, remote 404 |
| `error` | network/provider failure (the row carries the hint) |

`check` refreshes the installed version from disk before deciding, persists the refreshed version
together with `lastCheckedAt`/`lastCheckStatus`, and exits 0 regardless of the statuses (scripting
consumes the JSON).

## `update`

1. Resolve the source: the item's channel (`stable`, or `prerelease` when recorded/`--prerelease`) with
   the asset chosen by saved pattern then machine architecture, or the stored direct URL. Untrackable
   sources and items pinned elsewhere require `--url` / `--latest`.
2. If the release publishes a sha256 `digest` equal to the installed `artifact.sha256`, the download is
   skipped and the result is a no-op (with the reason recorded).
3. Otherwise download, inspect the real version, and apply the decision rules: same version + same
   hash ⇒ no-op; newer ⇒ install; older ⇒ refused (exit 6); unknown/uncomparable ⇒ confirmation
   (exit 3 in non-interactive/JSON mode).
4. On success the stored source is updated (a `tagComparable` mapping is recomputed) so later checks
   stay comparable.
