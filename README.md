<div align="center">

# dmngr

**Install and update any macOS app from a DMG or PKG — without opening the Finder.**

[![CI](https://github.com/SimStm/dmngr/actions/workflows/ci.yml/badge.svg)](https://github.com/SimStm/dmngr/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/SimStm/dmngr)](https://github.com/SimStm/dmngr/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/SimStm/dmngr/total)](https://github.com/SimStm/dmngr/releases)
[![Stars](https://img.shields.io/github/stars/SimStm/dmngr)](https://github.com/SimStm/dmngr/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-black.svg)](#requirements)
[![Built with Bun](https://img.shields.io/badge/built%20with-Bun-black.svg)](https://bun.sh)

</div>

Give dmngr a link (or a file) for an app and it installs it, remembers where it came from, and updates
it later with a single command.

```console
$ dmngr install 'https://github.com/exelban/stats' --json
{
  "action": "installed",
  "item": {
    "id": "eu.exelban.Stats",
    "displayName": "Stats",
    "installedPath": "/Applications/Stats.app",
    "installedVersion": "3.0.19"
  },
  "source": {
    "kind": "github-release",
    "repository": "exelban/stats",
    "tag": "v3.0.19",
    "asset": "Stats.dmg",
    "channel": "stable"
  }
}
```

> **In short:** paste a link → dmngr checks who published it, installs the right build for your Mac,
> keeps a list of what it installed, and tells you when a newer version is out. No Finder, no leftover
> downloads, no guesswork.

## Features

- **Install from a link or a file.** DMG and PKG, straight from the vendor's site or from a local
  download folder.
- **GitHub releases, handled properly.** Paste the repository, a release page or a direct download URL.
  dmngr finds the newest version, picks the build that matches your Mac (Apple Silicon or Intel), and
  can follow pre-releases with `--prerelease`.
- **Knows what it installed.** A small local list keeps the app, its version, where it came from and how
  that version was determined.
- **Tells you when there is something new.** `dmngr check` looks for updates without installing
  anything, and answers "not sure" instead of guessing.
- **Careful by default.** It inspects the app's signature before installing, keeps a backup of the
  previous version while replacing it, and asks before doing anything irreversible.
- **Script-friendly.** Stable `--json` output and meaningful exit codes for cron jobs and CI.
- **No `sudo dmngr`.** Your list of apps stays yours; administrator permission is requested only when a
  package installer itself needs it.

## Install

### Requirements

- macOS 12 or newer, on Apple Silicon or Intel.
- No Homebrew, Node.js or Xcode needed — the download is a single self-contained binary.

### Download and verify

Pick your architecture (not sure? `uname -m` prints `arm64` on Apple Silicon and `x86_64` on Intel):

```bash
ARCH=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo x64)
BASE="https://github.com/SimStm/dmngr/releases/latest/download"

curl -fLO "$BASE/dmngr-darwin-$ARCH"
curl -fLO "$BASE/dmngr-darwin-$ARCH.sha256"
shasum -a 256 -c "dmngr-darwin-$ARCH.sha256"   # must print: OK
```

### Install it (choose one)

**Option A — `~/.local/bin`, no administrator password (recommended)**

```bash
mkdir -p ~/.local/bin
chmod +x "dmngr-darwin-$ARCH"
mv "dmngr-darwin-$ARCH" ~/.local/bin/dmngr
```

If `~/.local/bin` is not on your `PATH` yet, add it once:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Use `~/.bash_profile` instead of `~/.zshrc` if your shell is bash.

**Option B — `/usr/local/bin`, already on `PATH` (asks for your password)**

```bash
chmod +x "dmngr-darwin-$ARCH"
sudo mv "dmngr-darwin-$ARCH" /usr/local/bin/dmngr
```

### Check it works

```bash
dmngr --version
dmngr --help
```

### Update dmngr itself

dmngr does not manage its own installation. To update, re-run the commands from
[Download and verify](#download-and-verify) and replace the binary with the new one:

```bash
mkdir -p ~/.local/bin
chmod +x "dmngr-darwin-$ARCH"
mv -f "dmngr-darwin-$ARCH" ~/.local/bin/dmngr
```

(With Option B, use `sudo mv -f "dmngr-darwin-$ARCH" /usr/local/bin/dmngr` instead.)

### Uninstall

```bash
rm "$(command -v dmngr)"
rm -rf "$HOME/Library/Application Support/dmngr"   # also forgets the apps it was tracking
```

The second command removes only dmngr's own list. **Installed apps are not touched.**

## Quick start

```bash
# install from a direct link
dmngr install 'https://example.org/Example.dmg'

# install the newest release directly from a GitHub repository
dmngr install 'https://github.com/exelban/stats'

# include pre-releases (beta, rc, nightly…)
dmngr install 'https://github.com/iina/iina' --prerelease

# keep exactly the version from a link, even if a newer one exists
dmngr install 'https://github.com/acme/editor/releases/download/v2.0.0/Editor-arm64.dmg' --pin

# see what is installed
dmngr list
dmngr info 'com.example.editor'

# look for updates without changing anything
dmngr check

# update one app, or everything that has a confirmed update
dmngr update 'com.example.editor'
dmngr update --all
```

Useful flags for any command: `--dry-run` (show what would happen), `--yes` (skip the questions that
are safe to skip), `--json` (machine-readable output), `--verbose`, `--quiet`.

## How it works

1. **Reads your link** and figures out where the app comes from.
2. **Asks the publisher** (for GitHub, the public API) which version is current, and which file is meant
   for your Mac's processor.
3. **Downloads it** and checks it: file hash, the app's signature, and whether it really is the app you
   asked for.
4. **Installs it** — copying the app into place while keeping the previous version aside until the swap
   succeeded.
5. **Writes it down** in a small local list, so `list`, `check` and `update` know about it.

Nothing is installed twice: running `install` again with the same version does nothing, and installing a
newer file for an app you already have counts as an update.

## Staying safe

- **You always get asked** before something irreversible happens: replacing an app that is different
  from the one you are installing, installing something without a proper Apple signature, replacing an
  app that runs only through Rosetta, or a package that runs installer scripts as administrator.
- **Uncertainty is stated, never hidden.** If dmngr cannot tell what version a link offers, it says so
  and asks, instead of pretending everything is fine.
- **Nothing is deleted on failure.** If an installation fails half-way, the previous app is put back and
  the leftover files are reported with their paths.
- **Only https by default**, and the app is checked before it is installed — not after.
- **No telemetry, no accounts.** The only network calls are the ones needed to fetch the app you asked
  for (plus the GitHub API for version information).

## Supported

| | |
| --- | --- |
| **Apps** | `.dmg` with an app inside, `.pkg` (directly or inside a `.dmg`) |
| **Sources** | GitHub releases (repository, release, tag or download link), any https link, a local file |
| **Architectures** | Apple Silicon (`arm64`) and Intel (`x64`), including universal builds |
| **Not yet** | `.zip` archives, encrypted disk images, Homebrew or Mac App Store apps, other operating systems |

Full details, including what dmngr does with each kind of link, live in
[`knowledge/product/`](./knowledge/product/).

## For scripts

```bash
dmngr list --json
dmngr check --json
dmngr install "$URL" --yes --json
```

Exit codes: `0` success or nothing to do · `2` wrong usage · `3` a decision is needed (run it in a
terminal or pass the suggested flag) · `4` network · `5` security check failed · `6` installation failed
· `7` local data is unreadable. Progress and errors go to stderr; data goes to stdout.

`--json` output always uses English keys, so scripts never depend on the language of the interactive
messages (the plain-text messages are in Portuguese for now).

## Documentation

- [`knowledge/product/`](./knowledge/product/) — how the installation pipeline, version checks and
  safety rules really work.
- [`knowledge/changes/`](./knowledge/changes/) — what changed and why, per release.
- [`CHANGELOG.md`](./CHANGELOG.md) — the summary that becomes each release's description.

## Development

```bash
bun install
bun run src/index.ts --help     # run from source
bun run typecheck
bun test                        # unit tests (no network)
bun run test:integration        # real DMG/PKG flows in temp folders (macOS)
bun run build:arm64             # standalone binary for Apple Silicon
bun run build:x64               # standalone binary for Intel
```

## Releasing

Releases are automated and driven by the changelog:

1. Add your changes under `## [Unreleased]` in [`CHANGELOG.md`](./CHANGELOG.md).
2. Go to **Actions → Release → Run workflow** and pick a bump (`patch`, `minor` or `major`), or mark
   *dry run* to see the plan without changing anything.
3. The workflow bumps `package.json` and `src/version.ts`, turns the `[Unreleased]` section into the new
   version with today's date, commits `chore(release): vX.Y.Z`, tags it, builds both architectures,
   publishes the binaries with `.sha256` checksums, and uses the changelog section as the release
   description.

Pushing a `vX.Y.Z` tag manually works too, as long as the version in the repository matches the tag.
An empty `[Unreleased]` section stops the release on purpose — the changelog is the source of the
release notes.

## License

[MIT](./LICENSE)
