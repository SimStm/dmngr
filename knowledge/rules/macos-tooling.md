---
type: Playbook
title: macOS tooling
description: How to call platform tools and how platform tests must behave.
tags: [agents, rules, macos, tests]
---

# macOS tooling

- Prefer machine-readable output: `hdiutil -plist` and `pkgutil --pkg-info-plist`, converted with `plutil -convert json -o - -- -` (also works from stdin).
- `plutil` cannot parse `PackageInfo` (root tag `pkg-info`); dmngr reads those attributes from the XML. Do not "fix" that with a plist parser.
- `pkgutil --expand` requires a **non-existent** target directory — use `tempPath()`.
- `spctl`, `pkgutil --check-signature` and `codesign -dv` exit codes are unreliable on their own: parse their text **and** capture exit codes without pipes.
- Mount with `-readonly -nobrowse -noverify -noautoopen`; always detach the device nodes the attach returned, including on error and SIGINT.
- Integration tests: build fixtures with `hdiutil`/`pkgbuild` inside `tempRoot()` (never `/Applications`), install with `--destination` pointing at a temp dir, `pkgutil --forget` any receipt created, and assert that no images stay mounted.
- Tests requiring root are gated; never make an ordinary test depend on sudo.
