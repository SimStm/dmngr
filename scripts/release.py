#!/usr/bin/env python3
"""Release helper for dmngr.

Two responsibilities, both driven by the single source of truth for the version
(`package.json` + `src/version.ts`) and by `CHANGELOG.md`:

  prepare --bump {patch,minor,major}   bump the version, promote the [Unreleased]
                                       changelog section to the new version and
                                       prepare the tree for a release commit
  notes --version X.Y.Z                print the changelog section for that
                                       version (used as the GitHub Release body)
  current                              print the current version

Only the Python standard library is used, so the script runs unchanged on macOS
and on the GitHub macOS runners.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path

BUMP_KINDS = ("patch", "minor", "major")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
CHANGELOG_HEADING_RE = re.compile(r"^##\s+\[(?P<label>[^\]]+)\](?:\s*-\s*(?P<date>.+))?\s*$")
VERSION_FILE_RE = re.compile(r'(export const VERSION = ")(?P<version>[^"]+)(";)')
PACKAGE_JSON_VERSION_RE = re.compile(r'("version":\s*")(?P<version>[^"]+)(")')


class ReleaseError(Exception):
    """Anything that must stop the release without changing the tree."""


# --------------------------------------------------------------------------- #
# repository helpers
# --------------------------------------------------------------------------- #


def repository_root(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).resolve()
    try:
        output = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        )
        return Path(output.stdout.strip())
    except (OSError, subprocess.CalledProcessError):
        return Path(__file__).resolve().parent.parent


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise ReleaseError(f"git {' '.join(args)} falhou: {result.stderr.strip()}")
    return result.stdout.strip()


def in_git_repository(root: Path) -> bool:
    try:
        return git(root, "rev-parse", "--is-inside-work-tree") == "true"
    except (ReleaseError, OSError):
        return False


def is_dirty(root: Path) -> bool:
    return len(git(root, "status", "--porcelain").strip()) > 0


def tag_exists(root: Path, tag: str) -> bool:
    return tag in git(root, "tag", "--list", tag).splitlines()


def tag_points_at_head(root: Path, tag: str) -> bool:
    try:
        return git(root, "rev-list", "-n", "1", tag) == git(root, "rev-parse", "HEAD")
    except ReleaseError:
        return False


# --------------------------------------------------------------------------- #
# version helpers
# --------------------------------------------------------------------------- #


def read_version(root: Path) -> str:
    package_file = root / "package.json"
    version_file = root / "src" / "version.ts"
    if not package_file.exists():
        raise ReleaseError(f"package.json não encontrado em {root}")
    if not version_file.exists():
        raise ReleaseError(f"src/version.ts não encontrado em {root}")

    package_version = json.loads(package_file.read_text())["version"]
    match = VERSION_FILE_RE.search(version_file.read_text())
    if match is None:
        raise ReleaseError("não foi possível ler VERSION de src/version.ts")
    source_version = match.group("version")

    if package_version != source_version:
        raise ReleaseError(
            "as versões estão fora de sincronia: "
            f"package.json={package_version} src/version.ts={source_version}"
        )
    if not VERSION_RE.match(package_version):
        raise ReleaseError(f"versão inválida (esperado X.Y.Z): {package_version}")
    return package_version


def next_version(current: str, kind: str) -> str:
    major, minor, patch = (int(part) for part in current.split("."))
    if kind == "major":
        return f"{major + 1}.0.0"
    if kind == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def write_version(root: Path, current: str, target: str) -> None:
    package_file = root / "package.json"
    package_text = package_file.read_text()
    replaced, count = PACKAGE_JSON_VERSION_RE.subn(rf'\g<1>{target}\g<3>', package_text, count=1)
    if count != 1 or f'"{current}"' not in package_text:
        raise ReleaseError("não foi possível atualizar a versão em package.json")
    package_file.write_text(replaced)

    version_file = root / "src" / "version.ts"
    version_text = version_file.read_text()
    replaced, count = VERSION_FILE_RE.subn(rf'\g<1>{target}\g<3>', version_text, count=1)
    if count != 1:
        raise ReleaseError("não foi possível atualizar VERSION em src/version.ts")
    version_file.write_text(replaced)


# --------------------------------------------------------------------------- #
# changelog helpers
# --------------------------------------------------------------------------- #


def changelog_path(root: Path) -> Path:
    path = root / "CHANGELOG.md"
    if not path.exists():
        raise ReleaseError("CHANGELOG.md não encontrado")
    return path


def split_sections(text: str) -> tuple[str, list[tuple[str, str]]]:
    """Return (preamble, [(heading, body), ...]) for level-2 sections."""
    headings: list[str] = []
    bodies: list[list[str]] = []
    preamble: list[str] = []
    for line in text.splitlines():
        if CHANGELOG_HEADING_RE.match(line):
            headings.append(line)
            bodies.append([])
            continue
        if bodies:
            bodies[-1].append(line)
        else:
            preamble.append(line)
    return (
        "\n".join(preamble),
        [(headings[index], "\n".join(bodies[index])) for index in range(len(headings))],
    )


def section_body(text: str, label: str) -> str | None:
    _, sections = split_sections(text)
    for heading, body in sections:
        match = CHANGELOG_HEADING_RE.match(heading)
        if match and match.group("label").strip().lower() == label.lower():
            return body.strip("\n")
    return None


def release_notes(text: str, version: str) -> str:
    body = section_body(text, version)
    if body is None:
        raise ReleaseError(f"não há seção ## [{version}] no CHANGELOG.md")
    return body.strip()


def count_entries(body: str) -> int:
    return sum(1 for line in body.splitlines() if line.strip().startswith(("- ", "* ")))


def promote_changelog(text: str, version: str, date: str) -> str:
    unreleased = section_body(text, "Unreleased")
    if unreleased is None:
        raise ReleaseError("não há seção ## [Unreleased] no CHANGELOG.md")
    if count_entries(unreleased) == 0:
        raise ReleaseError(
            "a seção [Unreleased] está vazia: escreva o que mudou antes de gerar uma release"
        )

    lines = text.splitlines()
    start: int | None = None
    end = len(lines)
    for index, line in enumerate(lines):
        match = CHANGELOG_HEADING_RE.match(line)
        if match is None:
            continue
        if start is None:
            if match.group("label").strip().lower() == "unreleased":
                start = index
            continue
        end = index
        break
    if start is None:
        raise ReleaseError("não foi possível localizar a seção [Unreleased]")

    body = lines[start + 1 : end]
    while body and body[0].strip() == "":
        body.pop(0)
    while body and body[-1].strip() == "":
        body.pop()

    promoted = ["## [Unreleased]", "", f"## [{version}] - {date}", "", *body, ""]
    rebuilt = [*lines[:start], *promoted, *lines[end:]]
    return "\n".join(rebuilt).rstrip("\n") + "\n"


# --------------------------------------------------------------------------- #
# commands
# --------------------------------------------------------------------------- #


def emit_outputs(pairs: dict[str, str]) -> None:
    target = os.environ.get("GITHUB_OUTPUT")
    if not target:
        return
    with open(target, "a", encoding="utf-8") as handle:
        for key, value in pairs.items():
            handle.write(f"{key}={value}\n")


def command_current(args: argparse.Namespace) -> int:
    root = repository_root(args.root)
    print(read_version(root))
    return 0


def command_notes(args: argparse.Namespace) -> int:
    root = repository_root(args.root)
    version = args.version.lstrip("v")
    notes = release_notes(changelog_path(root).read_text(), version)
    if args.output:
        Path(args.output).write_text(notes + "\n", encoding="utf-8")
        print(f"notas da versão {version} escritas em {args.output}")
    else:
        print(notes)
    return 0


def command_prepare(args: argparse.Namespace) -> int:
    root = repository_root(args.root)
    current = read_version(root)

    if in_git_repository(root):
        if is_dirty(root) and not args.allow_dirty:
            raise ReleaseError(
                "a árvore de trabalho tem alterações não commitadas; "
                "commite antes de preparar a release (ou use --allow-dirty)"
            )
    if args.resume:
        tag = f"v{current}"
        if not in_git_repository(root):
            raise ReleaseError("--resume exige um repositório git")
        if not tag_exists(root, tag):
            raise ReleaseError(f"--resume exige a tag {tag} já criada")
        if not tag_points_at_head(root, tag):
            raise ReleaseError(f"a tag {tag} não aponta para o HEAD; nada a retomar")
        print(f"retomando a release {tag} (sem novo bump)")
        emit_outputs({"version": current, "tag": tag, "resumed": "true"})
        return 0

    target = next_version(current, args.bump)
    tag = f"v{target}"

    if in_git_repository(root) and tag_exists(root, tag):
        raise ReleaseError(f"a tag {tag} já existe; escolha outro bump, remova a tag ou use --resume")

    changelog_file = changelog_path(root)
    changelog_text = changelog_file.read_text()
    notes = release_notes_or_unreleased(changelog_text, target)
    date = dt.date.today().isoformat()
    promoted = promote_changelog(changelog_text, target, date)

    print(f"versão atual: {current}")
    print(f"nova versão:  {target} (bump {args.bump})")
    print(f"tag:          {tag}")
    print(f"notas:        {count_entries(section_body(promoted, target) or '')} entrada(s) de changelog")

    if args.dry_run:
        print("dry-run: nada foi alterado")
        preview = notes.strip().splitlines()
        print("--- início das notas ---")
        print("\n".join(preview[:12]))
        if len(preview) > 12:
            print(f"... ({len(preview) - 12} linha(s) omitidas)")
        print("--- fim das notas ---")
        emit_outputs({"version": target, "tag": tag, "resumed": "false"})
        return 0

    write_version(root, current, target)
    changelog_file.write_text(promoted, encoding="utf-8")
    print("package.json, src/version.ts e CHANGELOG.md atualizados")
    emit_outputs({"version": target, "tag": tag, "resumed": "false"})
    return 0


def release_notes_or_unreleased(changelog_text: str, version: str) -> str:
    """Notes for the version being released (already promoted) or the current [Unreleased]."""
    body = section_body(changelog_text, version) or section_body(changelog_text, "Unreleased")
    if body is None:
        raise ReleaseError("não foi possível montar as notas da release")
    return body.strip()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="release.py", description="dmngr release helper")
    parser.add_argument("--root", help="raiz do repositório (padrão: descoberta via git)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare", help="prepara a release (bump + changelog)")
    prepare.add_argument("--bump", choices=BUMP_KINDS, default="patch")
    prepare.add_argument("--dry-run", action="store_true", help="mostra o plano e não altera nada")
    prepare.add_argument("--allow-dirty", action="store_true", help="permite árvore suja (não recomendado)")
    prepare.add_argument(
        "--resume",
        action="store_true",
        help="não faz bump: retoma a release da versão atual (tag já criada no HEAD)",
    )
    prepare.set_defaults(func=command_prepare)

    notes = subparsers.add_parser("notes", help="imprime a seção do CHANGELOG de uma versão")
    notes.add_argument("--version", required=True)
    notes.add_argument("--output", help="arquivo de saída (padrão: stdout)")
    notes.set_defaults(func=command_notes)

    current = subparsers.add_parser("current", help="imprime a versão atual")
    current.set_defaults(func=command_current)

    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except ReleaseError as error:
        print(f"erro: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
