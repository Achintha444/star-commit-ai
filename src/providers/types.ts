/**
 * Core provider abstraction types for Star Commit AI.
 *
 * All AI backends (Claude Code CLI, OpenAI, Gemini, etc.) must implement
 * the {@link CommitMessageProvider} interface so the rest of the extension
 * can interact with any provider through a single, stable contract.
 */

/**
 * Contract that every AI commit-message provider must satisfy.
 *
 * Providers are registered with {@link ProviderRegistry} during extension
 * activation and retrieved by ID when the user triggers generation.
 */
export interface CommitMessageProvider {
  /**
   * Stable, machine-readable identifier for this provider (e.g. `"claude-code"`).
   * Must match the value stored in the `starCommitAI.provider` setting.
   */
  readonly id: string;

  /**
   * Human-readable name shown in Quick Pick menus and notifications
   * (e.g. `"Claude Code"`).
   */
  readonly displayName: string;

  /**
   * Returns the list of models this provider supports.
   *
   * The default model (the one pre-selected when the user has not explicitly
   * chosen) must have {@link ProviderModel.isDefault} set to `true`.
   */
  getModels(): ProviderModel[];

  /**
   * Generates a commit message for the supplied diff text.
   *
   * @param diff - The raw git diff string to summarise.
   * @param model - The {@link ProviderModel.id} of the model to invoke.
   * @param options - Additional generation parameters (template, length cap, language).
   * @returns A promise that resolves to the generated commit message string.
   * @throws An error if the provider is unavailable or generation fails.
   */
  generateCommitMessage(
    diff: string,
    model: string,
    options: GenerateOptions,
  ): Promise<string>;

  /**
   * Checks whether this provider is currently usable.
   *
   * For CLI-based providers this typically verifies that the required
   * executable is present on `PATH`. Call this before
   * {@link generateCommitMessage} and show an actionable error if it
   * returns `false`.
   *
   * @returns `true` if the provider is ready; `false` otherwise.
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Describes a single model offered by a {@link CommitMessageProvider}.
 */
export interface ProviderModel {
  /**
   * Stable, machine-readable model identifier passed to the provider API
   * or CLI (e.g. `"sonnet"`, `"opus"`, `"haiku"`).
   */
  id: string;

  /**
   * Human-readable label displayed in Quick Pick menus
   * (e.g. `"Claude Sonnet — recommended"`).
   */
  displayName: string;

  /**
   * Whether this model should be pre-selected when the user has not
   * explicitly chosen one. Exactly one model per provider should be
   * marked as default.
   */
  isDefault: boolean;
}

/**
 * Optional parameters forwarded to {@link CommitMessageProvider.generateCommitMessage}.
 *
 * All fields are optional; providers should fall back to sensible defaults
 * when a field is omitted.
 */
export interface GenerateOptions {
  /**
   * Custom prompt template to use instead of the built-in prompt.
   * The literal string `{diff}` is replaced with the diff content at
   * generation time. An empty string or `undefined` means "use the default
   * prompt".
   */
  promptTemplate?: string;

  /**
   * Maximum number of characters to include from the diff before truncating.
   * Protects against extremely large diffs that would exceed model context
   * windows. Defaults to `8000` when omitted.
   */
  maxDiffLength?: number;

  /**
   * Natural language in which the commit message should be written
   * (e.g. `"english"`, `"spanish"`, `"japanese"`).
   * Defaults to `"english"` when omitted.
   */
  language?: string;

  /**
   * Whether to generate a detailed commit body in addition to the subject line.
   *
   * When `true`, the provider appends a blank line followed by a bullet-point
   * breakdown of the changes after the subject line. When `false`, only the
   * single-line subject is generated.
   *
   * Ignored when a custom `promptTemplate` is supplied — in that case the
   * template controls the output format entirely.
   *
   * Defaults to `true` when omitted.
   */
  includeCommitBody?: boolean;
}
