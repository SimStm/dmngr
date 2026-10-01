# Changelog

All notable changes to **dmngr** are documented here (English, macro view).

Deep detail lives in OKF bundles under `knowledge/changes/<yyyy-MM-dd>/<feature-or-fix-name>/`.
Format inspired by [Keep a Changelog](https://keepachangelog.com/).
The human-facing usage guide stays in the pt-BR [`README.md`](./README.md).

## [Unreleased]

### Fixed

- Pinning an asset for the wrong architecture (`--pin` with an arm64 build on an Intel Mac) now fails
  before the download with exit code 6 and a message naming the asset, instead of surfacing a signature
  error later. The pre-download architecture gate covers every asset path (explicit name, saved pattern,
  heuristic), not only the heuristic one.
- Unit tests use a 30 s default timeout (`bunfig.toml` + `tests/helpers/setup.ts`): the first
  `codesign`/`lipo`/`plutil` call on a freshly created CI runner is much slower than on a warm Mac, and
  the 5 s Bun default produced a false timeout on the arm64 runner.
  → [`knowledge/changes/2026-10-01/ci-fixes-arch-gate-and-timeout/`](./knowledge/changes/2026-10-01/ci-fixes-arch-gate-and-timeout/README.md)

## [0.2.0] - 2026-10-01

### Added

- English, user-facing `README.md` with badges, a plain-language overview and a complete installation
  guide (download, checksum verification, `~/.local/bin` with PATH guidance or `/usr/local/bin` with
  `sudo`, updating and uninstalling). Additive `LICENSE` (MIT).
- Automated releases: `scripts/release.py` (`prepare`, `notes`, `current`) bumps `package.json` and
  `src/version.ts`, promotes the `CHANGELOG.md` `[Unreleased]` section into a dated version section and
  blocks the release when that section is empty; `.github/workflows/release.yml` runs from one click
  (`patch|minor|major`, optional dry run) or a `vX.Y.Z` tag, gates on typecheck + unit + integration
  tests, commits `chore(release): vX.Y.Z [skip ci]`, tags, builds both architectures, publishes
  `.sha256` checksums plus `SHA256SUMS`, and creates the GitHub Release whose description is that
  changelog section. Failed runs resume from an unpublished tag instead of bumping twice.
  → [`knowledge/changes/2026-10-01/readme-and-release-automation/`](./knowledge/changes/2026-10-01/readme-and-release-automation/README.md)

### Changed

- `dmngr -V` was replaced by `dmngr -v` (the CLI had no published release yet); `--version` keeps working.
- CI runs on `macos-15` (arm64) and `macos-15-intel`, since GitHub retired the `macos-13` image; the
  native binary is smoke-tested on each runner.

- GitHub links are resolved through the API before installing: every release link form is accepted
  (repo page, `/releases`, `/releases/latest`, `/releases/tag/<tag>`, download URLs, API equivalents),
  the channel head is looked up (`stable`, or the newest published release with `--prerelease`), the
  macOS asset is selected by the machine architecture, and architecture is validated before the
  download (asset name) and after it (`lipo`, before touching anything installed). A URL that pins a
  version other than the channel head now always asks (`--pin` / `--latest`; exit 3 without a
  terminal); pins are recorded (`source.pinnedTag`) and `update` requires `--latest` to leave one. New
  flags: `--prerelease`, `--pin`, `--latest`, `--allow-arch-mismatch`; `doctor` reports the local
  environment.
  → [`knowledge/changes/2026-10-01/github-channel-and-arch-validation/`](./knowledge/changes/2026-10-01/github-channel-and-arch-validation/README.md)

- Agent knowledge system: root `AGENTS.md`, always-on rules (`knowledge/rules/`), durable product docs
  (`knowledge/product/`), the OKF change convention (`knowledge/changes/`) and this changelog.
  → [`knowledge/changes/2026-09-29/agents-knowledge-bootstrap/`](./knowledge/changes/2026-09-29/agents-knowledge-bootstrap/README.md)

- First functional version (baseline, documented retroactively): `install` from DMG/PKG (URL or local
  file), per-user JSON registry, GitHub Releases provider, `list`/`info`/`check`/`update`/`doctor`,
  two-tier signature policy, SSRF-safe downloads, stable `--json` output and exit codes, standalone
  arm64/x64 builds, unit + integration test suites.
  → [`knowledge/changes/2026-09-29/dmngr-mvp/`](./knowledge/changes/2026-09-29/dmngr-mvp/README.md)
