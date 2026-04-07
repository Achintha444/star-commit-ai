# Star Commit AI

VS Code extension that generates AI-powered commit messages from git diffs.

## Project Overview

- **Type**: VS Code Extension (TypeScript)
- **Bundler**: esbuild
- **Target**: VS Code ^1.85.0
- **Entry point**: `src/extension.ts` → bundled to `dist/extension.js`

## Architecture

### Provider Pattern
All AI providers implement `CommitMessageProvider` interface (`src/providers/types.ts`).
Claude Code CLI is the first provider. Future: GPT, Gemini via same interface.

### Key Components
- `src/providers/` — AI provider abstraction + implementations
- `src/git/gitService.ts` — Git diff reading (execFile to git CLI, vscode.git API for repo discovery)
- `src/scm/scmService.ts` — Populates VS Code SCM commit message input box
- `src/commands/generateCommitMessage.ts` — Main command orchestrator
- `src/config/settings.ts` — Typed settings accessor

### SCM Integration
- Button placed via `contributes.menus.scm/title` in package.json
- Condition: `when: "scmProvider == git"`
- Uses `vscode.git` extension API to access `repo.inputBox.value`

## Commands

```bash
# Build
node esbuild.js

# Production build
node esbuild.js --production

# Test (F5 in VS Code to launch Extension Development Host)
```

## Conventions

- Use `child_process.spawn` with **stdin** for passing diffs to CLI (not CLI args)
- All disposables must be added to `context.subscriptions`
- Activation: on-command only (no `*` activation)
- Settings namespace: `starCommitAI.*`
- Command namespace: `star-commit-ai.*`
- Default diff mode: all changes (not staged-only)
- Default model: sonnet

## Skills

- `.agents/skills/vscode-extension-expert/` — VS Code extension API patterns
- `.agents/skills/typescript-expert/` — TypeScript best practices
