---
name: star-commit-architecture
description: "Star Commit AI VS Code extension architecture. Use when implementing features, adding providers, modifying the command flow, or making changes that touch multiple components. Covers the provider pattern, SCM integration, git diff strategy, CLI invocation, settings schema, and error handling."
---

# Star Commit AI Architecture

## Overview

VS Code extension that generates AI-powered commit messages by reading git diffs and sending them to an AI provider (Claude Code CLI). The extension places a button in the SCM title bar and populates the commit message input box.

## Core Flow

```
SCM Button Click → Command Orchestrator → GitService.getDiff() → Provider.generateCommitMessage() → ScmService.setCommitMessage()
```

## Provider Pattern

All AI providers implement `CommitMessageProvider` (`src/providers/types.ts`):

```typescript
interface CommitMessageProvider {
  readonly id: string;
  readonly displayName: string;
  getModels(): ProviderModel[];
  generateCommitMessage(diff: string, model: string, options: GenerateOptions): Promise<string>;
  isAvailable(): Promise<boolean>;
}

interface ProviderModel {
  id: string;
  displayName: string;
  isDefault: boolean;
}

interface GenerateOptions {
  promptTemplate?: string;
  maxDiffLength?: number;
  language?: string;
}
```

### Adding a New Provider

1. Create `src/providers/<name>Provider.ts` implementing `CommitMessageProvider`
2. Register in `ProviderRegistry` during `activate()`
3. Add provider ID to `starCommitAI.provider` enum in `package.json`
4. For API key providers, use `vscode.SecretStorage` — never store keys in settings

## Component Map

| Component | Path | Role |
|-----------|------|------|
| Entry Point | `src/extension.ts` | Registers commands, providers, disposables |
| Command | `src/commands/generateCommitMessage.ts` | Orchestrates: diff → AI → SCM input |
| Provider Types | `src/providers/types.ts` | `CommitMessageProvider` interface |
| Claude Provider | `src/providers/claudeCodeProvider.ts` | `spawn("claude", ["-p", "--model", m])` with stdin |
| Provider Registry | `src/providers/providerRegistry.ts` | Map of provider ID → instance |
| Git Service | `src/git/gitService.ts` | `execFile("git", ["diff", ...])` for diff text |
| SCM Service | `src/scm/scmService.ts` | `repo.inputBox.value = message` |
| Settings | `src/config/settings.ts` | Typed accessor for `starCommitAI.*` |

## SCM Integration

- **Button**: `contributes.menus.scm/title` → `group: "navigation"` → `when: "scmProvider == git"`
- **Input box**: `vscode.extensions.getExtension('vscode.git').exports.getAPI(1).repositories[N].inputBox.value`
- **Multiple repos**: Show quick pick if `repositories.length > 1`

## Git Diff Strategy

- **Repo discovery**: `vscode.git` extension API
- **Diff text**: `child_process.execFile("git", ["diff", ...], { cwd: repoRoot })`
- **All changes**: `git diff HEAD` (default)
- **Staged only**: `git diff --cached`
- **Initial commit** (no HEAD): `git diff --cached`

## Claude Code CLI Integration

- Invoke via `child_process.spawn("claude", ["-p", "--model", model])`
- Pass prompt (including diff) via **stdin** — never as CLI args (length limits)
- Read generated message from **stdout**
- 30s timeout via `AbortController`
- Check availability with `claude --version`

## Settings

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `starCommitAI.provider` | string | `"claude-code"` | Active AI provider |
| `starCommitAI.model` | string | `"sonnet"` | Model: opus / sonnet / haiku |
| `starCommitAI.diffMode` | string | `"all"` | all changes or staged only |
| `starCommitAI.promptTemplate` | string | `""` | Custom prompt (`{diff}` placeholder) |
| `starCommitAI.maxDiffLength` | number | `8000` | Max diff chars sent to provider |
| `starCommitAI.commitMessageLanguage` | string | `"english"` | Output language |

## Commands

| ID | Title | Where |
|----|-------|-------|
| `star-commit-ai.generateCommitMessage` | Generate Commit Message | SCM title bar + palette |
| `star-commit-ai.selectModel` | Select AI Model | Palette |
| `star-commit-ai.selectDiffMode` | Select Diff Mode | Palette |

## Namespacing

- Settings: `starCommitAI.*`
- Commands: `star-commit-ai.*`

## Error Handling

| Scenario | Detection | Response |
|----------|-----------|----------|
| CLI not installed | `isAvailable()` false | Error + install instructions |
| No git repo | No repositories | "Open a git repository first" |
| Empty diff | Empty string from getDiff | "No changes detected" |
| CLI timeout | AbortController (30s) | "Generation timed out" + retry |
| CLI error | Non-zero exit / stderr | Show stderr in error message |
| Multiple repos | repos.length > 1 | Quick pick selector |
| Diff too large | Exceeds maxDiffLength | Truncate with warning |

## Build

- **Bundler**: esbuild → `dist/extension.js`
- **Format**: CommonJS
- **External**: `["vscode"]`
- **Source maps**: Enabled in dev, disabled in production

## Activation

- `onCommand:star-commit-ai.generateCommitMessage` only
- Never use `*` — zero startup cost when not in use
