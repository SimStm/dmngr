---
type: concept
title: GitHub release channel and architecture validation — spec
description: Contract for API-driven channel resolution and architecture validation of GitHub links.
tags: [change, github-channel-and-arch-validation, spec]
---

# Spec — GitHub release channel and architecture validation

## Problem

Today a GitHub URL is only understood when it points directly at a release asset
(`/releases/download/<tag>/<asset>` or `/releases/latest/download/<asset>`). Other GitHub links are
refused, and there is no notion of a release *channel*: a URL that pins an old release is installed as
is, with no indication that a newer release exists, and nothing is validated against the machine's
architecture before the app is installed. Users can end up installing an old version, or a build for a
different CPU, without warning.

## Goal

When a GitHub link is given — for `install` or `update` — identify `owner/repo` and resolve the release
through the public API: the newest published release of the channel (stable by default, or the newest
published release including prereleases with `--prerelease`), the macOS asset for the machine's
architecture (`arm64` / `x64` / universal), and validate that against the local system before
installing. Never choose between the URL's pinned version and the channel head silently.

## Scope

### In scope

- Accept GitHub link forms: `github.com/<o>/<r>`, `.../releases`, `.../releases/latest`,
  `.../releases/tag/<tag>`, `.../releases/download/<tag>/<asset>`,
  `.../releases/latest/download/<asset>`, and the `api.github.com/repos/<o>/<r>/releases…` equivalents.
- Channel resolution: `stable` (GitHub `releases/latest`) and `--prerelease` (newest non-draft release,
  stable or prerelease, by publication date).
- Detect the macOS asset and its architecture from the API metadata before downloading
  (`arm64`: `arm64|aarch64|apple-silicon|silicon`; `x64`: `x64|x86_64|amd64|intel`; `universal|univ`
  or no token = unknown/universal), excluding assets that look like Windows/Linux builds.
- Validate the chosen asset against the machine: `arm64` machine accepts `arm64`, universal and unknown
  (with a note); `x64` asset on an `arm64` machine requires confirmation (Rosetta 2) and is recorded;
  `arm64` asset on an `x64` machine is blocked with no override (it cannot run).
- Re-validate after download with the real bundle architectures (`lipo`) before installing.
- Pinned-versus-channel decision: when the URL pins a tag that is not the channel head, always ask.
  Non-interactive (or `--json`/`--dry-run`) exits with code 3 and explains `--pin` and `--latest`.
  `--pin` requires a tag in the URL; `--pin` and `--latest` together are a usage error.
- Record the selected channel (`source.channel`) and whether the item is pinned (`source.pinnedTag`), so
  `check`/`update` follow the same channel and respect the pin.
- New flags on `install`, `update` and `check`: `--prerelease`; on `install` and `update`: `--pin`,
  `--latest`, `--allow-arch-mismatch`.
- `doctor` reports the local environment (macOS version and machine architecture).

### Out of scope

- ZIP assets (still unsupported), Windows/Linux artifacts, GitHub Enterprise hosts.
- Reading the minimum macOS version from the API — it is not exposed; the app's
  `LSMinimumSystemVersion` is only visible after download and is not used as a gate in this change.
- Automatic downgrades, `--allow-downgrade`, uninstall.

## Expected behavior

1. **Repo links work.** `install <repo|releases|tag page URL>` resolves the release through the API; a
   tag page resolves that tag; a repo/releases page resolves the channel head.
2. **Channel is explicit.** Without `--prerelease` the stable channel is used. With it, the newest
   non-draft release (stable or prerelease) is used. The chosen channel is stored on the item and used
   by `check` and `update <item>`; `--prerelease` on those commands switches it for that run.
3. **Pinned URLs ask.** If the URL pins a tag and the channel head differs, the user chooses between the
   pinned version and the channel head (`--pin` / `--latest` in non-interactive mode). If the tags are
   equal, nothing is asked. Dry-run reports both without asking.
4. **Architecture is checked twice.** Before download from asset names, and after download from the real
   bundle (`lipo`) — both against the local machine, with the policy above.
5. **Asset selection stays deterministic.** Exact asset name → saved pattern → machine architecture →
   universal/unknown; several equally compatible assets require a choice (exit 3 without a prompt).
   Assets that only exist for other platforms are never selected.
6. **Text and JSON report the decision.** Output/`notes` name the repository, channel, tag, asset and
   architecture evidence; `--json` adds the same facts to the report.

## Scenarios

### Main

- `dmngr install https://github.com/exelban/stats` → API → stable head `v3.0.19` → asset `Stats.dmg`
  (no arch token → unknown → confirmed after download) → installs as today.
- `dmngr install https://github.com/acme/editor/releases/download/v2.0.0/Editor-arm64.dmg` on an
  Apple Silicon Mac when `v3.0.0` is the head → asks "pinned v2.0.0 or head v3.0.0"; `--latest`
  installs `v3.0.0` (asset re-selected for the machine), `--pin` keeps `v2.0.0`.
- `dmngr install <repo> --prerelease` → newest published release including prereleases.
- `dmngr check` for an item installed from a prerelease → queries the prerelease channel.
- `dmngr update <item>` for an item pinned with `--pin` → reports the pin and refuses to jump channels;
  `--latest` clears it after a successful update.

### Error

- URL pins a tag but the run is non-interactive without `--pin`/`--latest` → exit 3 naming both flags.
- `--pin` with a URL that does not pin a version → exit 2.
- `--pin` together with `--latest` → exit 2.
- Only `arm64` assets exist and the machine is `x64` → exit 6 (`InstallError`) with the available
  assets listed; `--allow-arch-mismatch` does not override this case.
- Only `x64` assets exist on an `arm64` machine → interactive confirmation or
  `--allow-arch-mismatch`; when Rosetta 2 is unavailable the same case is blocked, with the reason.
- The installed bundle contains no slice for this machine (e.g. asset name lied) → blocked after
  download, before touching the installed app.
- Repository without published releases, or no macOS asset in the selected release → exit 4 with the
  asset list.

### Edge cases

- URL tag equals the channel head → no question.
- Head release does not contain the asset name from the URL → falls back to selection with a note.
- Machine architecture and the installed item's architecture differ (e.g. updating a universal app with
  an `arm64`-only release) → the existing `arch-change` confirmation still applies.
- Repos that publish Windows/Linux assets alongside macOS ones → only macOS candidates are considered.
- Draft releases are never selected; prerelease channel skips drafts.
- `DMNGR_GITHUB_API_URL` (tests/enterprise) redirects API calls; asset URLs still come from the API
  response and are validated by the normal network policy.

## Acceptance criteria

- [x] `parseGithubUrl` (replacing `parseGithubReleaseUrl`) recognizes repo, `/releases`,
  `/releases/latest`, `/releases/tag/<tag>`, both `/download/` forms and the API equivalents, keeps
  refusing `/archive/…`, and gives a usage error for known non-installable GitHub sections.
- [x] `GithubClient` can list releases and resolve the channel head for `stable` and `--prerelease`
  (newest non-draft by publication date); drafts are skipped.
- [x] Asset selection excludes non-macOS assets, prefers the machine architecture, and returns an
  explicit "incompatible" result (with the available candidates) when no asset fits.
- [x] Pre-download architecture validation: `arm64` on `x64` blocked with no override; `x64` on `arm64`
  requires confirmation/`--allow-arch-mismatch` (recorded as `arch-mismatch`) and mentions Rosetta;
  unknown architecture is noted and confirmed after download.
- [x] Post-download validation using `lipo` architectures runs before the app is installed, with the
  same policy.
- [x] Pinned-vs-head decision is asked interactively, exits 3 non-interactively, and is bypassed by
  `--pin` / `--latest`; `--pin` without a pinned URL and `--pin` + `--latest` are usage errors.
- [x] The chosen channel is stored in `source.channel`, a deliberate pin is stored in
  `source.pinnedTag`, and `check`/`update` follow them (`--prerelease` overrides the channel for the run).
- [x] `doctor` prints the local macOS version and machine architecture.
- [x] Unit tests cover URL parsing, channel selection, asset/platform/arch selection, compatibility
  matrices and the new CLI flags; an integration test exercises the whole flow against a local fake
  GitHub API, including the pinned/channel question and the architecture block.
- [x] `bun run typecheck`, `bun test tests/unit` and `bun run test:integration` pass.
