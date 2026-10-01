# AGENTS.md — dmngr

Agent-facing guide for this repository. Follow existing project patterns unless the task introduces something genuinely new.

**macOS CLI that installs and updates apps obtained from a URL or local file (DMG/PKG), tracking origin, identity and version in a per-user registry.** This repository is the entire product: one Bun/TypeScript CLI compiled into standalone `arm64`/`x64` binaries. It is *not* a Homebrew / Mac App Store / MDM replacement, and it never imports apps that dmngr did not install.

**Language:** `AGENTS.md`, everything under `knowledge/`, `CHANGELOG.md` and `README.md` are written in **English**. The exception is the CLI surface: help, errors and prompts stay in **Portuguese (pt-BR)**, as do comments inside existing pt-BR source files. `--json` keys and machine-readable codes are always English. Never mix two languages inside one file; match the file you are editing.

**Naming (code, not prose):** English identifiers (`installedVersion`, `resolveSourceForUpdate`). Portuguese is allowed only inside user-facing string literals. Retroactive: when touching a file, keep its consistency — but never rename CLI flags, JSON keys, registry fields or exit codes as a side effect (they are a public compatibility surface).

## Before you start

1. Read this file.
2. Read every `knowledge/rules/*.md` file **except** `knowledge/rules/README.md`.
3. Skim the relevant `knowledge/product/` docs when the task touches that domain.
4. For any feature or fix: open `knowledge/changes/<yyyy-MM-dd>/<name>/` with `spec.md`, `plan.md` and `tasks.md` **before editing code** (`knowledge/changes/README.md` has the convention).
5. Run the baseline checks before changing anything: `bun run typecheck && bun test tests/unit`.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime / language | Bun 1.3+ with TypeScript `strict` (`noUncheckedIndexedAccess`, `noUnusedLocals`), ESM with explicit `.ts` import specifiers |
| Platform | macOS only (uses `hdiutil`, `installer`, `pkgutil`, `codesign`, `spctl`, `plutil`, `lipo`) |
| CLI | Commander (the only runtime dependency) |
| State | JSON registry + config under `~/Library/Application Support/dmngr/`, atomic writes, file lock |
| Tests | `bun:test` — unit (offline) + integration (real DMG/PKG, opt-in via `DMNGR_INTEGRATION=1`) |
| Distribution | `bun build --compile` for `bun-darwin-arm64` / `bun-darwin-x64`, GitHub Actions release on `v*` tags |

## Project structure

```
src/
  index.ts            # entry point (calls runCli)
  cli/                # Commander program + text/table rendering
  core/
    errors.ts         # error taxonomy and exit codes (public contract)
    output.ts         # stdout = data, stderr = progress/warnings
    process.ts        # Bun.spawn wrapper: array args, never a shell
    fsx.ts            # atomic write, sha256, dir helpers
    paths.ts          # state dir layout (+ DMNGR_APP_SUPPORT_DIR override)
    registry/         # schema + validation, store, lock, item resolution
    input/            # input classification, SSRF policy, download, format detection
    inspect/          # .app bundle + PKG inspection (identity, version, signature)
    install/          # DMG attach/detach, app staging/swap, PKG installation
    ops/              # decision + orchestration (install/update/check/doctor/live)
    providers/        # GitHub Releases client and asset selection
  core/versioning.ts  # version comparison and tag↔version mapping
tests/
  unit/               # offline; local HTTP server for network behaviour
  integration/        # real hdiutil/pkgbuild fixtures in temp dirs (opt-in)
  helpers/fixtures.ts # fixture builders and CLI runner
knowledge/
  rules/              # short, always-on, tool-agnostic rules
  product/            # durable product/domain knowledge
  changes/            # OKF change bundles (spec/plan/tasks per change)
```

## Conventions that matter

- **Exit codes are a contract.** `0` ok/no-op, `1` internal, `2` usage, `3` ambiguity/decision needed, `4` network, `5` security/integrity, `6` installation, `7` inconsistent state. Never reuse a code for a different meaning; never swallow an error into `0`.
- **stdout only carries data** (text or `--json`). Progress, warnings and errors go to stderr.
- **`--json` never prompts.** When a decision is required in JSON mode, fail with exit code 3 and explain the flags to pass. `--yes` answers only unambiguous decisions.
- **`unknown` is a legitimate answer.** Never report `update_available` without evidence read from the artifact or a validated tag mapping. Never auto-install when the version is unknown or versions are incomparable.
- **Identity before installation.** Association between an artifact and a registry item uses bundle id / PKG identifiers — never the file name. Changes of bundle id, architecture, or a downgrade require explicit confirmation and are recorded in `verification.overrides`.
- **State is written only after verified success**, under the registry lock, and the installed version is re-read from disk on `info`/`check`/`update` (apps can self-update).
- **Privilege is scoped.** dmngr never runs as root: elevation happens only around `/usr/sbin/installer`. The registry stays per-user.
- **No shell interpolation, ever.** All native tools run through `run()`/`runChecked()` with argument arrays.

## Knowledge

### Always-on rules — `knowledge/rules/`

Short, tool-agnostic rules loaded at task start. Add a new short rule when a constraint must apply to every future task. `knowledge/rules/` is the source of truth for these rules — not IDE-specific folders.

### Product knowledge — `knowledge/product/`

Durable behaviour that outlives one change: pipeline semantics, version truth rules, security policy, registry/CLI contracts, known limitations. Update it when the product's stable behaviour changes.

### OKF changes — `knowledge/changes/`

Spec: [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

```
knowledge/changes/<yyyy-MM-dd>/<feature-or-fix-name>/
  README.md   # summary, issues/tasks, affected repositories, links
  spec.md     # contract: problem, goal, scope, scenarios, acceptance criteria
  plan.md     # current code analysis, decisions, risks, sequence, deviations
  tasks.md    # ordered tasks with verification commands and status
```

1. One directory = one implementation set; follow-ups stay in the same directory.
2. Cross-repo work would share the identical `<feature-or-fix-name>`; this product currently has a single repository.
3. Concepts need OKF frontmatter (`type` required; prefer `title`, `description`, `tags`).
4. `spec.md`, `plan.md` and `tasks.md` are required — the bundle `README.md` does not replace them.
5. Bundles marked `provenance: retroactive` document already-shipped work; do not imitate that pattern for new work.

### Planning and implementation

Before implementing a feature or fix, create or update one bundle (reuse it for follow-ups on the same change). Keep `spec.md` behavioural and testable, `plan.md` grounded in real file paths, and `tasks.md` ordered with the command that verifies each step. A new session must be able to execute the change from those three files alone, so keep repository facts separated from proposals and assumptions.

Plan-only requests: write and review the bundle, do not change code. Implementation requests: confirm the bundle still matches the code, update it first if it drifted, and keep it current as discoveries appear.

When implementation finishes: check every acceptance criterion in `spec.md`, run the relevant tests, record results and limitations, mark the finished tasks, and justify technical deviations in `plan.md`. If a discovery requires changing behaviour defined in `spec.md`, state that decision before editing the spec.

### Self-learning loop

| After the work… | Write to… |
| --- | --- |
| Constraint for every future task | `knowledge/rules/<topic>.md` + index in `rules/README.md` |
| Durable product/domain behaviour | `knowledge/product/<topic>.md` |
| This feature/fix set | `knowledge/changes/<date>/<name>/` — open before code (`spec.md`, `plan.md`, `tasks.md`); finish after the work |
| Human macro history | `CHANGELOG.md` (link the OKF path) |
| Human onboarding / run / structure | `README.md` |

Chat conclusions that change how the product works are incomplete until written into `knowledge/`.

### Agent definition of done

- [ ] Code + tests as needed (skip code when the request was plan-only)
- [ ] OKF bundle created/updated, including `spec.md`, `plan.md`, and `tasks.md`
- [ ] For an implementation: each `spec.md` acceptance criterion checked; relevant tests run; results and limitations recorded; `tasks.md` marked; technical deviations justified in `plan.md`
- [ ] CHANGELOG entry linked to the OKF path
- [ ] Product and/or rules updated if durable behaviour/constraints changed
- [ ] README updated if the human onboarding surface changed

## CHANGELOG.md

Append a macro entry (English, newest first) after each feature or fix set, mirroring the OKF identity (same date folder and name) and linking its path. Keep a Changelog categories: Added, Changed, Fixed, Removed.

## README.md

`README.md` is the human onboarding surface and is written in pt-BR. Update it in the same change set when usage, flags, exit codes, installation or behaviour visible to users changes.

## Code quality bar

- Prefer small, explicit functions over abstraction layers; this CLI is deliberately dependency-light.
- Security-relevant checks (`codesign`, `spctl`, hash, identity, SSRF) must be verifiable from tests and must fail closed.
- Anything that mutates the system is reversible or documented as not reversible: staging + backup for `.app`, explicit warning for PKG scripts.
- Tests: unit tests must not touch the network (use `Bun.serve` locally); integration tests build their own DMG/PKG in temp dirs, never in `/Applications`, and must clean up mounts, receipts and temp state. Tests that need root are gated with `test.skipIf(process.getuid?.() !== 0)`.
- Keep `bun run typecheck` clean; the build must stay compilable for both `bun-darwin-arm64` and `bun-darwin-x64`.

## Commands

```bash
bun install                  # dependencies
bun run src/index.ts --help  # run the CLI from source
bun run typecheck            # tsc --noEmit
bun test tests/unit          # unit tests (offline)
bun run test:integration     # real DMG/PKG flows (DMNGR_INTEGRATION=1)
bun run build:arm64          # standalone binary (arm64)
bun run build:x64            # standalone binary (x64, cross-compiled)
python3 scripts/release.py current            # current version (package.json + src/version.ts)
python3 scripts/release.py prepare --bump patch --dry-run   # preview a release plan
python3 scripts/release.py notes --version 1.0.0            # release notes for a version
```

Releases are cut by `.github/workflows/release.yml` (Actions → Release → Run workflow, or a `vX.Y.Z`
tag push). The workflow runs the quality gate, bumps `package.json` + `src/version.ts`, promotes the
`CHANGELOG.md` `[Unreleased]` section into a dated version section, commits `chore(release): vX.Y.Z
[skip ci]`, tags, builds both architectures, publishes `.sha256` checksums and creates the GitHub
Release whose description is that changelog section. Details:
`knowledge/product/release-and-versioning.md`.

## What not to do

- Do not leave a feature or fix without an OKF bundle (including `spec.md`, `plan.md`, `tasks.md`) and a CHANGELOG entry.
- Do not edit code for a feature or fix before those three files exist and match the current code.
- Do not change behaviour defined in `spec.md` without stating that decision first.
- Do not put always-on rules only in IDE-specific config — use `knowledge/rules/`.
- Do not rename CLI flags, JSON keys, registry fields or exit codes as part of an unrelated change.
- Do not edit version numbers by hand: `package.json` and `src/version.ts` are written together by
  `scripts/release.py prepare`, and releases are cut from a non-empty `CHANGELOG.md` `[Unreleased]` section.
- Do not remove `com.apple.quarantine`, do not bypass Gatekeeper, and do not make `--yes` consent to security warnings or ambiguity.
- Do not add runtime dependencies without a rule/product note explaining why (Commander is currently the only one).
- Do not shell out with `sh -c` or interpolate paths into command strings; use `run([...])` and, for elevation, the `osascript` argv form.
- Do not promise package-manager semantics: PKG installation is not transactional, and dmngr does not manage apps it did not install.
