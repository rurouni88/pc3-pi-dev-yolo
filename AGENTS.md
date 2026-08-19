# Agent Instructions — pi-dev-yolo

## Purpose

This repository is a development workspace for pi (pi-coding-agent) extensions. All extension work follows the workflow below.

## Extension Development Workflow

### Phase 1: Create

All extensions are built in the local repo first:

```
extensions/
├── my-extension.ts        # Extension source
└── my-extension.test.ts   # Unit tests
```

**Rules:**
- One extension per pair of files (source + test)
- Export pure functions for testing (`export function detectInjection`)
- The extension factory function stays as `export default function (pi: ExtensionAPI)`

### Phase 2: Test

Run unit tests before anything else:

```bash
npx tsx extensions/my-extension.test.ts
```

- No test framework — custom assertion runner in each test file
- Tests must pass before proceeding to review
- Test names describe behavior, not implementation (`returns_true_when_valid` not `test_valid`)

### Phase 3: Compliance

Check against `CODING_STANDARDS.md`. Key rules:

| Standard | What to verify |
|---|---|
| **Readability** | Early returns, no nested `if/else` pyramids, intermediate variables with meaningful names |
| **Naming** | Descriptive names, no single-letter vars (except loop counters), booleans read as assertions (`isValid`) |
| **Function size** | One responsibility per function, no side effects mixed with computation |
| **Comments** | Only explain *why*, never narrate *what*, no dead code |
| **YAGNI** | No unused exports, no config for hypothetical features |
| **DRY** | If logic is duplicated in two places, extract it |
| **Security** | No hardcoded secrets, validate at boundaries, no command injection |

If a standard is unclear, read the surrounding code first and follow existing patterns.

### Phase 4: Review

Before deployment, present the extension to the user with:

1. **Source code** — the full `extensions/my-extension.ts`
2. **Test output** — the result of running `npx tsx extensions/my-extension.test.ts`
3. **Compliance notes** — any standards deviations with rationale
4. **What it does** — a plain-language summary of the extension's behavior

Wait for user approval. Do not deploy until the user explicitly confirms.

### Phase 5: Deploy

Only after user approval:

```bash
# Copy extension to active directory
cp extensions/my-extension.ts ~/.pi/agent/extensions/

# If replacing an existing extension, remove the old one first
rm ~/.pi/agent/extensions/my-extension.ts
cp extensions/my-extension.ts ~/.pi/agent/extensions/
```

Then ask the user to reload:

> Extension deployed to `~/.pi/agent/extensions/`. Run `/reload` in pi to activate it.

### Phase 6: Commit

After deployment (or if the user declines and wants to keep working on it):

```bash
git add extensions/
git commit --author="PC3 <rurouni88@gmail.com>" -m "PC3 <description of changes>"
```

Commit author matches existing history. Prefix every commit with `PC3 `.

## Active Extensions

Two guard extensions are installed and active in `~/.pi/agent/extensions/`:

### `permission-gate.ts`
- Blocks `rm -rf`, `sudo`, `chmod/chown 777` in bash
- Requires confirmation for all `write`/`edit` operations
- Session-scoped: remembers approved paths for the session
- Whitelists: project root and `~/.pi/agent/extensions`

### `prompt-injection-guard.ts`
- Scans all external input: user messages, RPC, skills, templates, tool results, conversation context
- Detects injection patterns: ignore-instructions, system-prompt-extraction, developer-mode, hypothetical-framing, etc.
- Decodes obfuscation: base64, URL encoding, HTML entities
- Auto-blocks critical severity, flags high/medium with warnings

## What This Repo Is Not

- Not a production deployment
- Not a shared npm package (yet)
- A playground for extension logic, testing, and iteration
