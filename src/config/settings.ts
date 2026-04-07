import * as vscode from 'vscode';

/**
 * The configuration section key shared by all Star Commit AI settings.
 * Matches the `starCommitAI.*` namespace declared in `package.json`.
 */
const CONFIGURATION_SECTION = 'starCommitAI' as const;

/**
 * Controls which git changes are included in the diff sent to the AI provider.
 */
export enum DiffMode {
  /**
   * Include all changes relative to HEAD — both staged (indexed) and unstaged
   * working-tree modifications. Corresponds to `git diff HEAD`.
   */
  All = 'all',

  /**
   * Include only staged (indexed) changes. Corresponds to `git diff --cached`.
   * Useful when the user has carefully curated their index.
   */
  Staged = 'staged',
}

/**
 * Typed, read-only accessor for all `starCommitAI.*` workspace settings.
 *
 * Wraps `vscode.workspace.getConfiguration` so the rest of the extension
 * never has to deal with raw strings or missing-value fallbacks. Each getter
 * re-reads the live configuration object, so changes made by the user take
 * effect immediately without restarting the extension.
 *
 * Usage:
 * ```typescript
 * const settings = new Settings();
 * const model = settings.model;           // "sonnet"
 * const mode  = settings.diffMode;        // DiffMode.All
 * ```
 */
export class Settings {
  /**
   * Retrieves the current VS Code workspace configuration scoped to the
   * `starCommitAI` section.
   *
   * @returns The scoped {@link vscode.WorkspaceConfiguration} object.
   */
  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  }

  /**
   * The AI provider to use for commit message generation.
   *
   * Corresponds to `starCommitAI.provider`.
   * Default: `"claude-code"`.
   */
  get provider(): string {
    return this.config.get<string>('provider', 'claude-code');
  }

  /**
   * The model identifier forwarded to the active provider
   * (e.g. `"opus"`, `"sonnet"`, `"haiku"`).
   *
   * Corresponds to `starCommitAI.model`.
   * Default: `"sonnet"`.
   */
  get model(): string {
    return this.config.get<string>('model', 'sonnet');
  }

  /**
   * Determines which git changes are included in the diff.
   *
   * Returns a {@link DiffMode} enum value. Falls back to {@link DiffMode.All}
   * if the stored value is unrecognised.
   *
   * Corresponds to `starCommitAI.diffMode`.
   * Default: {@link DiffMode.All}.
   */
  get diffMode(): DiffMode {
    const raw = this.config.get<string>('diffMode', DiffMode.All);
    return raw === DiffMode.Staged ? DiffMode.Staged : DiffMode.All;
  }

  /**
   * Optional custom prompt template.
   *
   * When non-empty, the provider replaces the `{diff}` placeholder with the
   * actual diff content. An empty string signals "use the built-in prompt".
   *
   * Corresponds to `starCommitAI.promptTemplate`.
   * Default: `""` (empty — use built-in prompt).
   */
  get promptTemplate(): string {
    return this.config.get<string>('promptTemplate', '');
  }

  /**
   * Maximum number of characters to include from the diff before truncating.
   *
   * Prevents excessively large diffs from exhausting model context windows.
   * Must be a positive integer.
   *
   * Corresponds to `starCommitAI.maxDiffLength`.
   * Default: `8000`.
   */
  get maxDiffLength(): number {
    return this.config.get<number>('maxDiffLength', 8000);
  }

  /**
   * Natural language for the generated commit message
   * (e.g. `"english"`, `"spanish"`, `"japanese"`).
   *
   * Corresponds to `starCommitAI.commitMessageLanguage`.
   * Default: `"english"`.
   */
  get commitMessageLanguage(): string {
    return this.config.get<string>('commitMessageLanguage', 'english');
  }
}
