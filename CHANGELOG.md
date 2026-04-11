# Changelog

## [1.0.8] - 2026-04-11

### Added
- Commit body generation — AI now produces a subject line plus a detailed bullet-point breakdown of changes
- New setting `starCommitAI.includeCommitBody` (default: `true`) to toggle between subject-only and subject + body output
- Prompt templates moved to external JSON file (`src/prompts/prompts.json`) for easier customization

## [1.0.7] - 2026-04-09

### Fixed
- Overhauled Claude CLI path resolution for robust cross-platform detection
- Added known install paths for Homebrew (Apple Silicon and Intel), Volta, and pnpm global installs
- Bare `"claude"` fallback is no longer cached — allows retry after user installs CLI without restarting VS Code
- `isAvailable()` short-circuits when an absolute path is resolved, avoiding unnecessary spawn of `claude --version`
- Added 5-second timeout to `isAvailable()` spawn to prevent indefinite hang when CLI triggers auth prompt with no TTY
- Improved error message to suggest restarting VS Code and show both install methods (curl installer and npm)

## [1.0.6] - 2026-04-09

### Fixed
- Fixed "All changes" diff mode not including untracked (new) files — previously only tracked file modifications were sent to the AI, causing commit messages to miss newly added files
- Untracked files are now formatted as synthetic unified diffs and appended to the tracked diff
- Binary files are automatically skipped; capped at 100 untracked files to avoid oversized diffs
- Fixed `stdout maxBuffer length exceeded` error when diffing large changesets by increasing buffer limit to 10 MB

## [1.0.3] - 2026-04-08

### Fixed
- Fixed Claude CLI not found for standalone installer (`curl ... | bash`) users by resolving binary path through login shell, `~/.claude/bin/`, and npm global bin fallback

## [1.0.2] - 2026-04-08

### Fixed
- Fixed Claude Code CLI not being detected on macOS when installed via npm global (`shell: true` for spawn)

## [1.0.1] - 2026-04-08

### Changed
- Redesigned extension icon with modern rounded-square shape, gold sparkle star, and accent sparkles
- Updated SCM title bar icons for both dark and light themes
- Improved marketplace searchability with better description, keywords, and README

## [1.0.0] - 2026-04-07

### Added
- Initial release
- AI-powered commit message generation using Claude Code CLI
- Source Control panel integration with star icon button
- Model selection: Claude Opus, Sonnet, Haiku
- Diff mode: all changes or staged only
- Custom prompt template support
- Configurable commit message language
- Configurable max diff length
