---
type: Playbook
title: Artifact language
description: English for agent-facing artifacts; pt-BR for the human product surface.
tags: [agents, rules, docs]
---

# Artifact language

- Write `AGENTS.md`, everything under `knowledge/`, `CHANGELOG.md`, `README.md`, and new guidance comments in **English**.
- Keep **pt-BR** for the CLI help/errors/prompts and for comments inside existing pt-BR source files. `--json` keys and machine-readable codes are always English, so scripts never depend on the language of the interactive messages.
- Do not mix languages inside one file: match the file you are editing.
- Identifiers in code are English; Portuguese only inside user-facing string literals.
- See also: `knowledge/product/product-overview.md`
