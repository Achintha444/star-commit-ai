<p align="center">
  <img src="resources/icon.png" alt="Star Commit AI" width="64" />
</p>

<h1 align="center">Star Commit AI</h1>

<p align="center">
  <strong>Auto-generate smart commit messages from git diffs using Claude AI — one click from the VS Code Source Control panel.</strong>
</p>

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/AchinthaIsuru.star-commit?label=VS%20Code%20Marketplace&color=7C3AED)](https://marketplace.visualstudio.com/items?itemName=AchinthaIsuru.star-commit)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

No more writing commit messages manually. Star Commit AI reads your changes, understands the context, and generates meaningful [Conventional Commits](https://www.conventionalcommits.org/) messages instantly.

---

## Features

### AI-Powered Commit Messages from Git Diffs

Star Commit AI reads your current git diff — staged, unstaged, or all changes — and sends it to Claude AI to generate a meaningful, context-aware commit message. No more staring at a blank input box.

### One-Click from the Source Control Panel

A star icon button is placed directly in the VS Code Source Control title bar. Click it once to generate and populate the commit message input box without leaving the panel.

### Model Selection (Opus, Sonnet, Haiku)

Choose the Claude model that fits your workflow:

- **Opus** — Most capable. Best quality, best for complex or large diffs.
- **Sonnet** — Balanced. The recommended default for everyday commits.
- **Haiku** — Fastest. Lower latency, ideal for quick, small commits.

### Diff Mode Selection

Control what gets sent to the AI:

- **All changes** (default) — includes both staged and unstaged changes relative to HEAD, plus any untracked (new) files.
- **Staged only** — includes only changes that have been added to the index.

### Custom Prompt Templates

Override the built-in prompt with your own using a custom template. Use `{diff}` as a placeholder for the diff content. This lets you enforce team conventions, specify output formats, or add extra context.

### Conventional Commits Format

The built-in prompt instructs the AI to produce commit messages following the [Conventional Commits](https://www.conventionalcommits.org/) specification (`feat:`, `fix:`, `chore:`, etc.), keeping your history clean and parseable.

---

## Getting Started

**Step 1 — Install the extension**

Search for "Star Commit AI" in the VS Code Extensions panel and install it.

**Step 2 — Install the Claude Code CLI**

Star Commit AI relies on the Claude Code CLI to communicate with the AI. Install it using either method:

**Option A — Standalone installer (recommended)**
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Option B — npm global install**
```bash
npm install -g @anthropic-ai/claude-code
```

After installing, authenticate with your Anthropic account by running:

```bash
claude
```

Follow the prompts to complete authentication. The extension will use the same authenticated session.

**Step 3 — Generate a commit message**

1. Open a git repository in VS Code.
2. Make some changes to your files.
3. Open the Source Control panel (`Ctrl+Shift+G` / `Cmd+Shift+G`).
4. Click the "Star Commit AI" icon in the Source Control title bar.
5. The generated commit message will appear in the commit input box, ready to review and submit.

---

## Configuration

All settings are under the `starCommitAI` namespace and can be configured in your VS Code settings (`settings.json` or the Settings UI).

| Setting | Type | Default | Description |
|---|---|---|---|
| `starCommitAI.provider` | string | `"claude-code"` | The AI provider to use. Currently only `claude-code` is supported. |
| `starCommitAI.model` | string | `"sonnet"` | The Claude model to use: `opus`, `sonnet`, or `haiku`. |
| `starCommitAI.diffMode` | string | `"all"` | Which changes to send: `"all"` (staged + unstaged) or `"staged"` (staged only). |
| `starCommitAI.promptTemplate` | string | `""` | Custom prompt template. Use `{diff}` as the diff placeholder. Leave empty to use the built-in prompt. |
| `starCommitAI.maxDiffLength` | number | `8000` | Maximum number of characters to send from the diff. Longer diffs are truncated. |
| `starCommitAI.commitMessageLanguage` | string | `"english"` | The natural language to write the commit message in (e.g. `"english"`, `"spanish"`, `"japanese"`). |

---

## Commands

All commands are available from the VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`). Search for "Star Commit AI" to find them.

| Command | Description |
|---|---|
| `Star Commit AI: Generate Commit Message` | Read the current diff and generate a commit message. Also available as the star icon in the Source Control title bar. |
| `Star Commit AI: Select AI Model` | Open a quick pick to switch between Opus, Sonnet, and Haiku. |
| `Star Commit AI: Select Diff Mode` | Open a quick pick to switch between "all changes" and "staged only". |

---

## Requirements

- **VS Code** 1.85.0 or later.
- **Claude Code CLI** installed and authenticated. Supported install methods: [standalone installer](https://claude.ai/install.sh), `npm install -g @anthropic-ai/claude-code`, Homebrew, Volta, or pnpm. The extension auto-detects the CLI location.
- A git repository open in your workspace.

---

## Roadmap

The extension is built on a provider abstraction layer, making it straightforward to add new AI backends. Planned additions:

- **OpenAI (GPT-4)** — via the OpenAI API with a key stored securely in VS Code's `SecretStorage`.
- **Google (Gemini)** — via the Gemini API with the same secure key management pattern.

Model selection will become dynamic based on the active provider's available models when additional providers are added.

---

## Why Star Commit AI?

- **Save time** — stop writing commit messages by hand for every change
- **Consistent style** — every message follows Conventional Commits format automatically
- **Context-aware** — Claude reads the actual diff, not just file names, producing accurate descriptions
- **Zero config** — install, click the star, done. No API keys to manage (uses your Claude Code CLI session)
- **Works with any install method** — automatically detects Claude CLI whether installed via standalone installer, npm, Homebrew, Volta, or pnpm
- **Multilingual** — generate commit messages in any language (English, Spanish, Japanese, etc.)
- **Privacy-first** — diffs are sent directly to Claude via your authenticated CLI session, not through any third-party server

---

## License

MIT — see [LICENSE](./LICENSE) for details.
