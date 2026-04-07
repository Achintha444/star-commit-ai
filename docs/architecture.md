# Star Commit AI - Architecture & Guidelines

## Overview

Star Commit AI is a VS Code extension that generates AI-powered commit messages. It places a button in the VS Code Source Control (SCM) title bar, reads the git diff from the active repository, sends it to an AI provider (starting with Claude Code CLI), and populates the SCM commit message input box with the generated message.

## Architecture

### High-Level Flow

```
┌──────────────┐     ┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│  SCM Button  │────>│  Command      │────>│  CommitMessage    │────>│  SCM Input   │
│  (Click)     │     │  Orchestrator │     │  Provider (Claude)│     │  Box         │
└──────────────┘     └──────┬───────┘     └───────────────────┘     └──────────────┘
                            │
                     ┌──────▼───────┐
                     │  Git Service  │
                     │  (read diff)  │
                     └──────────────┘
```

1. User clicks the star icon in the SCM title bar
2. The command orchestrator reads the git diff via `GitService`
3. The diff is sent to the active `CommitMessageProvider` (Claude Code CLI)
4. The generated message is written to the SCM input box via `ScmService`

### Project Structure

```
star-commit-ai/
├── .vscode/
│   ├── launch.json                     # Extension Development Host debug config
│   └── tasks.json                      # Build tasks (esbuild)
├── src/
│   ├── extension.ts                    # Entry point: activate / deactivate
│   ├── commands/
│   │   └── generateCommitMessage.ts    # Main command orchestrator
│   ├── providers/
│   │   ├── types.ts                    # CommitMessageProvider interface & shared types
│   │   ├── claudeCodeProvider.ts       # Claude Code CLI implementation
│   │   └── providerRegistry.ts         # Registry for managing multiple providers
│   ├── git/
│   │   └── gitService.ts              # Git diff reading (child_process + vscode.git API)
│   ├── scm/
│   │   └── scmService.ts             # SCM input box interaction
│   └── config/
│       └── settings.ts                # Typed access to extension settings
├── resources/icons/
│   ├── star-commit.svg                # SCM button icon (dark theme)
│   └── star-commit-light.svg         # SCM button icon (light theme)
├── package.json                       # Extension manifest (commands, menus, settings)
├── tsconfig.json                      # TypeScript configuration
├── esbuild.js                         # Bundle script
└── .vscodeignore                      # Files excluded from extension package
```

### Component Responsibilities

| Component | File | Responsibility |
|-----------|------|---------------|
| Entry Point | `src/extension.ts` | Registers commands, creates providers, manages disposables |
| Command | `src/commands/generateCommitMessage.ts` | Orchestrates the full flow: diff -> AI -> SCM input |
| Provider Interface | `src/providers/types.ts` | Defines the contract all AI providers must implement |
| Claude Provider | `src/providers/claudeCodeProvider.ts` | Invokes Claude Code CLI via `child_process.spawn` |
| Provider Registry | `src/providers/providerRegistry.ts` | Stores and retrieves registered providers by ID |
| Git Service | `src/git/gitService.ts` | Reads git diff (all or staged) using `child_process.execFile` |
| SCM Service | `src/scm/scmService.ts` | Writes generated message to the VS Code SCM input box |
| Settings | `src/config/settings.ts` | Typed accessor for all `starCommitAI.*` settings |

## Provider Abstraction

The extension uses a provider pattern to support multiple AI backends. All providers implement the `CommitMessageProvider` interface:

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

Adding a new provider (e.g., GPT, Gemini) requires:
1. Create a new class implementing `CommitMessageProvider`
2. Register it in the `ProviderRegistry` during `activate()`
3. Add the provider ID to the `starCommitAI.provider` enum in `package.json`

## Key Design Decisions

### 1. Claude Code CLI via stdin

Diffs are passed to the Claude CLI through **stdin**, not as command-line arguments. This avoids shell argument length limits and escaping issues.

```
spawn("claude", ["-p", "--model", <model>])  →  write prompt to stdin  →  read stdout
```

A 30-second timeout is enforced via `AbortController`.

### 2. Git Diff Strategy

- **Repo discovery**: Uses the `vscode.git` extension API (`vscode.extensions.getExtension('vscode.git')`) to find repositories and check state
- **Diff text**: Uses `child_process.execFile("git", ["diff", ...])` because the VS Code git API does not expose a "get full diff as string" method
- **Default mode**: All changes (`git diff HEAD`), with an option for staged only (`git diff --cached`)
- **Initial commit**: Falls back to `git diff --cached` when HEAD doesn't exist

### 3. SCM Integration

- **Button placement**: Registered via `contributes.menus.scm/title` with `group: "navigation"` — places the icon directly in the SCM title bar
- **Visibility condition**: `when: "scmProvider == git"` — only shows for git repositories
- **Input box access**: `repo.inputBox.value` is a read-write property on the git extension API

### 4. Activation Strategy

The extension activates only on command invocation (`onCommand:star-commit-ai.generateCommitMessage`), not on startup. This ensures zero performance impact when the extension is installed but not in use.

## Extension Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `starCommitAI.provider` | `string` | `"claude-code"` | AI provider to use |
| `starCommitAI.model` | `string` | `"sonnet"` | Model: `opus`, `sonnet`, or `haiku` |
| `starCommitAI.diffMode` | `string` | `"all"` | `"all"` (all changes) or `"staged"` (staged only) |
| `starCommitAI.promptTemplate` | `string` | `""` | Custom prompt template. Use `{diff}` as placeholder. Empty = default prompt |
| `starCommitAI.maxDiffLength` | `number` | `8000` | Maximum characters to send from the diff |
| `starCommitAI.commitMessageLanguage` | `string` | `"english"` | Language for the generated commit message |

## Commands

| Command ID | Title | Available In |
|------------|-------|-------------|
| `star-commit-ai.generateCommitMessage` | Generate Commit Message | SCM title bar icon + Command Palette |
| `star-commit-ai.selectModel` | Select AI Model | Command Palette |
| `star-commit-ai.selectDiffMode` | Select Diff Mode | Command Palette |

## Error Handling

| Scenario | Detection | User Feedback |
|----------|-----------|---------------|
| Claude CLI not installed | `isAvailable()` returns false | Error message with install instructions |
| No git repository open | No repositories from `vscode.git` API | "Open a git repository first" |
| No changes detected | `getDiff()` returns empty string | "No changes detected" info message |
| CLI timeout (30s) | `AbortController` signal | "Generation timed out" with retry option |
| CLI error | Non-zero exit code / stderr | Display stderr content in error message |
| Multiple repositories | `repositories.length > 1` | Quick pick to select which repo |
| Diff too large | Character count exceeds `maxDiffLength` | Truncate with warning |

## Build & Tooling

- **Bundler**: esbuild (fast, single-file output)
- **Format**: CommonJS (`format: "cjs"`)
- **Platform**: Node.js
- **External**: `vscode` module (provided by VS Code runtime, not bundled)
- **Output**: `dist/extension.js`
- **Source maps**: Enabled in development

```bash
node esbuild.js              # Development build
node esbuild.js --production # Minified production build
npx tsc --noEmit             # Type checking only
```

## Testing

Manual testing via the Extension Development Host:

1. Press `F5` in VS Code to launch Extension Development Host
2. Open a git repository in the new VS Code window
3. Verify the star icon appears in the SCM title bar
4. Make file changes
5. Click the icon — verify progress notification and commit message population
6. Test edge cases: staged-only mode, empty diff, no git repo, model switching

## Future Expansion

The provider pattern enables adding new AI backends without modifying existing code:

- **OpenAI (GPT)**: New provider class, API key via `SecretStorage`
- **Google (Gemini)**: New provider class, API key via `SecretStorage`
- **Model selection**: Will become a dynamic quick pick based on the active provider's `getModels()` response
