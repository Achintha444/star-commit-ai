/**
 * Main command orchestrator for Star Commit AI.
 *
 * This module contains {@link generateCommitMessage}, the handler invoked when
 * the user clicks the SCM title-bar button or triggers the command from the
 * Command Palette. It coordinates all other services:
 *
 * 1. Read settings via {@link Settings}.
 * 2. Discover git repositories via {@link getRepositories}.
 * 3. Prompt the user to choose a repo when multiple are open.
 * 4. Read the git diff via {@link getDiff}.
 * 5. Retrieve and validate the configured {@link CommitMessageProvider}.
 * 6. Generate the commit message.
 * 7. Write the result to the SCM input box via {@link setCommitMessage}.
 *
 * All user-visible output (progress indicator, info/error messages) is managed
 * here so that the individual service modules remain UI-agnostic.
 */

import * as vscode from "vscode";
import { Settings } from "../config/settings";
import { getRepositories, getDiff } from "../git/gitService";
import { setCommitMessage } from "../scm/scmService";
import type { ProviderRegistry } from "../providers/providerRegistry";

// ---------------------------------------------------------------------------
// Inline type alias — mirrors the subset of the vscode.git `Repository`
// interface used by `getRepositories()` in gitService.ts.
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a repository returned by {@link getRepositories}.
 *
 * Declared locally to avoid coupling this module to gitService's unexported
 * `Repository` interface.
 */
interface Repository {
  /** Absolute URI of the repository root directory. */
  readonly rootUri: vscode.Uri;
  /** The SCM commit-message input box associated with this repository. */
  readonly inputBox: { value: string };
}

// ---------------------------------------------------------------------------
// Public command handler
// ---------------------------------------------------------------------------

/**
 * Handles the `star-commit-ai.generateCommitMessage` command.
 *
 * Wraps the entire flow in a {@link vscode.window.withProgress} notification
 * so the user receives immediate visual feedback. Any unhandled error is caught
 * and surfaced as an actionable VS Code error message.
 *
 * @param registry - The {@link ProviderRegistry} populated during extension
 *   activation. Queried with the provider ID from the user's settings to
 *   obtain the active {@link CommitMessageProvider}.
 * @returns A promise that resolves when the command completes (successfully or
 *   after displaying an error to the user). Never rejects — all errors are
 *   surfaced as VS Code notifications.
 */
export async function generateCommitMessage(
  registry: ProviderRegistry,
): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Generating commit message...",
        cancellable: false,
      },
      async () => {
        await runGenerateFlow(registry);
      },
    );
  } catch (error: unknown) {
    /** Human-readable message extracted from the caught value. */
    const message =
      error instanceof Error ? error.message : "An unknown error occurred.";
    vscode.window.showErrorMessage(`Star Commit AI: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Core implementation of the commit-message generation flow.
 *
 * Separated from {@link generateCommitMessage} so the progress wrapper is kept
 * thin and all business logic lives in a single, testable function.
 *
 * @param registry - Provider registry forwarded from the command handler.
 * @throws An {@link Error} for any failure condition; the caller is responsible
 *   for catching and displaying the error to the user.
 */
async function runGenerateFlow(registry: ProviderRegistry): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Read settings
  // -------------------------------------------------------------------------

  /** Typed accessor for all `starCommitAI.*` workspace settings. */
  const settings = new Settings();

  /** Provider ID from settings (e.g. `"claude-code"`). */
  const providerId = settings.provider;

  /** Model identifier forwarded to the provider (e.g. `"sonnet"`). */
  const model = settings.model;

  /** Which changes to include in the diff. */
  const diffMode = settings.diffMode;

  /** Character cap applied to the diff before sending to the AI. */
  const maxDiffLength = settings.maxDiffLength;

  /** Custom prompt template, or empty string to use the built-in prompt. */
  const promptTemplate = settings.promptTemplate;

  /** Natural language for the generated commit message. */
  const commitMessageLanguage = settings.commitMessageLanguage;

  // -------------------------------------------------------------------------
  // 2. Discover git repositories
  // -------------------------------------------------------------------------

  /** All git repositories open in the current workspace. */
  const repositories = getRepositories() as Repository[];

  if (repositories.length === 0) {
    throw new Error(
      "No git repository found. Open a folder with a git repository.",
    );
  }

  // -------------------------------------------------------------------------
  // 3. If multiple repos are open, ask the user which one to target
  // -------------------------------------------------------------------------

  /** Zero-based index into `repositories` for the selected repo. */
  let repoIndex = 0;

  if (repositories.length > 1) {
    /** Quick pick items, one per repository. */
    const items: Array<vscode.QuickPickItem & { index: number }> =
      repositories.map((repo, idx) => ({
        label: repo.rootUri.fsPath,
        description: `Repository ${idx + 1}`,
        index: idx,
      }));

    /** The item chosen by the user, or `undefined` if dismissed. */
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select the repository to generate a commit message for",
    });

    if (!picked) {
      // User dismissed the quick pick — abort silently.
      return;
    }

    repoIndex = picked.index;
  }

  /** Absolute filesystem path to the selected repository's root. */
  const repoPath = repositories[repoIndex].rootUri.fsPath;

  // -------------------------------------------------------------------------
  // 4. Read the git diff
  // -------------------------------------------------------------------------

  /** Raw git diff string for the selected mode and repository. */
  const diff = await getDiff(diffMode, repoPath);

  if (diff.trim().length === 0) {
    // Show an informational message (not an error) so the status bar icon
    // remains accessible and the user is not alarmed.
    vscode.window.showInformationMessage(
      "Star Commit AI: No changes detected to generate a commit message.",
    );
    return;
  }

  // -------------------------------------------------------------------------
  // 5. Retrieve and validate the configured provider
  // -------------------------------------------------------------------------

  /** The provider matching the user's `starCommitAI.provider` setting. */
  const provider = registry.get(providerId);

  if (!provider) {
    throw new Error(
      `Unknown provider "${providerId}". ` +
        `Check your starCommitAI.provider setting.`,
    );
  }

  /** Whether the provider's underlying CLI / API is currently reachable. */
  const available = await provider.isAvailable();

  if (!available) {
    throw new Error(
      `${provider.displayName} is not available. If already installed, try restarting VS Code. ` +
        `Install via: curl -fsSL https://claude.ai/install.sh | bash  or  npm install -g @anthropic-ai/claude-code`,
    );
  }

  // -------------------------------------------------------------------------
  // 6. Generate the commit message
  // -------------------------------------------------------------------------

  /** The generated commit message returned by the AI provider. */
  const message = await provider.generateCommitMessage(diff, model, {
    promptTemplate,
    maxDiffLength,
    language: commitMessageLanguage,
  });

  // -------------------------------------------------------------------------
  // 7. Write the message to the SCM input box
  // -------------------------------------------------------------------------

  /** Whether the message was successfully written to the SCM input box. */
  const written = await setCommitMessage(message, repoIndex);

  if (!written) {
    // The git extension may have become unavailable between the diff read and
    // this point.  Show the message in a notification as a fallback so the
    // user's output is never silently discarded.
    vscode.window.showInformationMessage(
      `Star Commit AI generated a message but could not write it to the SCM ` +
        `input box:\n\n${message}`,
    );
  }
}
