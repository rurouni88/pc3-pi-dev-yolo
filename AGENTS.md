# Agent Instructions — pi-dev-yolo

## Project Overview

This is a personal repository for developing and testing pi (pi-coding-agent) extensions and configurations. The goal is rapid iteration on extension code, testing injection guards, permission gates, and other agent behaviors.

## Extension Development

### Location

Extensions live in `extensions/`. Install globally with:

```bash
cp extensions/*.ts ~/.pi/agent/extensions/
```

Or test inline:

```bash
pi -e ./extensions/extension-name.ts
```

### Running Tests

```bash
npx tsx extensions/extension-name.test.ts
```

### Extension Conventions

- One responsibility per file
- Export pure functions for testing (`export function detectInjection`)
- Tests run with `npx tsx` — no framework needed
- Follow `CODING_STANDARDS.md` for all code

## Security Extensions

Two guard extensions are installed and active:

### 1. `permission-gate.ts`
- Blocks `rm -rf`, `sudo`, `chmod 777` in bash commands
- Requires confirmation for all `write`/`edit` operations
- Session-scoped: approves remembered per-session
- Whitelists: project root (`pc3-pi-dev-yolo`) and extensions dir (`~/.pi/agent/extensions`)

### 2. `prompt-injection-guard.ts`
- Scans all external input: user messages, RPC calls, skill/template expansions, tool results, conversation context
- Detects: ignore-instructions, system-prompt-extraction, developer-mode, hypothetical-framing, base64/URL/HTML obfuscation bypasses
- Auto-blocks critical severity (score ≥ 20)
- Flags high/medium with console warnings

## Commit Standards

- Author: **PC3** (`rurouni88@gmail.com`) — matches existing history
- Prefix: `PC3 ` (e.g., `PC3 Add extension for X`)
- Follows CODING_STANDARDS.md for code quality

## Workflow

1. Write extension in `extensions/`
2. Run tests: `npx tsx extensions/name.test.ts`
3. Copy to `~/.pi/agent/extensions/` for live testing
4. Commit with `git commit --author="PC3 <rurouni88@gmail.com>"`
5. Push when ready

## What This Repo Is Not

- Not a production deployment
- Not a shared library (yet)
- A playground for extension logic that may eventually be packaged as pi packages
