/**
 * Star Commit AI — VS Code extension entry point.
 *
 * This module exports the two lifecycle hooks that VS Code calls:
 * - {@link activate} — called once when the extension is first needed.
 * - {@link deactivate} — called when the extension is unloaded.
 *
 * `activate` is responsible for:
 * 1. Creating the {@link ProviderRegistry} and registering all providers.
 * 2. Registering the three extension commands and adding their disposables
 *    to `context.subscriptions` so VS Code cleans them up automatically.
 *
 * Activation is lazy: the `onCommand:star-commit-ai.generateCommitMessage`
 * activation event in `package.json` ensures this module is loaded only when
 * the user first invokes a command, keeping the extension's startup cost at
 * zero for users who have it installed but are not actively using it.
 */

import * as vscode from "vscode";
import { ProviderRegistry } from "./providers/providerRegistry";
import { ClaudeCodeProvider } from "./providers/claudeCodeProvider";
import { generateCommitMessage } from "./commands/generateCommitMessage";
import { Settings, DiffMode } from "./config/settings";

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

/**
 * Called by VS Code when the extension is activated for the first time.
 *
 * Sets up the provider registry, registers all three commands, and ensures
 * every disposable resource is tracked in `context.subscriptions`.
 *
 * @param context - The extension context provided by VS Code. Used to register
 *   disposables so they are automatically cleaned up when the extension is
 *   deactivated or uninstalled.
 */
export function activate(context: vscode.ExtensionContext): void {
  // -------------------------------------------------------------------------
  // Provider setup
  // -------------------------------------------------------------------------

  /**
   * Central registry holding all registered {@link CommitMessageProvider}
   * instances.  Populated here and passed by reference to command handlers
   * that need to look up the active provider.
   */
  const registry = new ProviderRegistry();

  /** The Claude Code CLI provider — the initial and default AI backend. */
  const claudeProvider = new ClaudeCodeProvider();
  registry.register(claudeProvider);

  // -------------------------------------------------------------------------
  // Command: star-commit-ai.generateCommitMessage
  // -------------------------------------------------------------------------

  /**
   * Disposable for the main "Generate Commit Message" command.
   *
   * Invokes the full generation flow: diff reading, AI call, SCM write.
   * Registered for both the SCM title-bar button and the Command Palette.
   */
  const generateCommandDisposable = vscode.commands.registerCommand(
    "star-commit-ai.generateCommitMessage",
    () => generateCommitMessage(registry),
  );

  // -------------------------------------------------------------------------
  // Command: star-commit-ai.selectModel
  // -------------------------------------------------------------------------

  /**
   * Disposable for the "Select AI Model" command.
   *
   * Shows a Quick Pick listing all models supported by the currently
   * configured provider.  The active model is marked with a checkmark
   * (✓). Persists the selection to the global `starCommitAI.model`
   * workspace configuration.
   */
  const selectModelDisposable = vscode.commands.registerCommand(
    "star-commit-ai.selectModel",
    async () => {
      /** Typed accessor for reading the current settings. */
      const settings = new Settings();

      /** The provider selected in the user's settings. */
      const provider = registry.get(settings.provider);

      if (!provider) {
        vscode.window.showErrorMessage(
          `Star Commit AI: Unknown provider "${settings.provider}". ` +
            `Check your starCommitAI.provider setting.`,
        );
        return;
      }

      /** Current model ID from settings — used to mark the active item. */
      const currentModel = settings.model;

      /** Quick Pick items, one per model offered by the active provider. */
      const items: vscode.QuickPickItem[] = provider.getModels().map((m) => ({
        label: currentModel === m.id ? `$(check) ${m.displayName}` : m.displayName,
        description: m.isDefault ? "default" : undefined,
        /** Attach the model ID as a detail so we can retrieve it after pick. */
        detail: m.id,
      }));

      /** The item selected by the user, or `undefined` if dismissed. */
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Select the AI model to use for commit message generation",
      });

      if (!picked || !picked.detail) {
        // User dismissed the picker — nothing to do.
        return;
      }

      /** The VS Code workspace configuration scoped to `starCommitAI`. */
      const config = vscode.workspace.getConfiguration("starCommitAI");

      /** Persist the chosen model ID globally so it applies across workspaces. */
      await config.update("model", picked.detail, vscode.ConfigurationTarget.Global);

      vscode.window.showInformationMessage(
        `Star Commit AI: Model switched to ${picked.label.replace("$(check) ", "")}.`,
      );
    },
  );

  // -------------------------------------------------------------------------
  // Command: star-commit-ai.selectDiffMode
  // -------------------------------------------------------------------------

  /**
   * Disposable for the "Select Diff Mode" command.
   *
   * Presents the user with a two-item Quick Pick to choose between including
   * all changes or staged-only changes in the diff.  Persists the selection
   * to the global `starCommitAI.diffMode` configuration.
   */
  const selectDiffModeDisposable = vscode.commands.registerCommand(
    "star-commit-ai.selectDiffMode",
    async () => {
      /** Typed accessor for reading the current diff mode setting. */
      const settings = new Settings();

      /** The currently configured diff mode — used to mark the active item. */
      const currentMode = settings.diffMode;

      /**
       * The two available diff modes presented to the user.
       *
       * `detail` carries the {@link DiffMode} value written to settings;
       * `label` is the human-readable label shown in the Quick Pick.
       */
      const items: Array<vscode.QuickPickItem & { modeValue: DiffMode }> = [
        {
          label:
            currentMode === DiffMode.All
              ? "$(check) All Changes"
              : "All Changes",
          description: "Include staged and unstaged changes relative to HEAD",
          modeValue: DiffMode.All,
        },
        {
          label:
            currentMode === DiffMode.Staged
              ? "$(check) Staged Only"
              : "Staged Only",
          description: "Include only staged (indexed) changes",
          modeValue: DiffMode.Staged,
        },
      ];

      /** The item chosen by the user, or `undefined` if dismissed. */
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Select which changes to include in the diff",
      });

      if (!picked) {
        // User dismissed the picker — nothing to do.
        return;
      }

      /** The VS Code workspace configuration scoped to `starCommitAI`. */
      const config = vscode.workspace.getConfiguration("starCommitAI");

      /** Persist the chosen diff mode globally so it applies across workspaces. */
      await config.update(
        "diffMode",
        picked.modeValue,
        vscode.ConfigurationTarget.Global,
      );

      /** Display name of the chosen mode, with the checkmark prefix stripped. */
      const modeName = picked.label.replace("$(check) ", "");

      vscode.window.showInformationMessage(
        `Star Commit AI: Diff mode switched to "${modeName}".`,
      );
    },
  );

  // -------------------------------------------------------------------------
  // Register all disposables
  // -------------------------------------------------------------------------

  /** Push all disposables so VS Code cleans them up on extension deactivation. */
  context.subscriptions.push(
    generateCommandDisposable,
    selectModelDisposable,
    selectDiffModeDisposable,
  );
}

/**
 * Called by VS Code immediately before the extension is unloaded.
 *
 * All registered disposables are already cleaned up via `context.subscriptions`,
 * so no manual teardown is required here.
 */
export function deactivate(): void {
  // Intentionally empty — cleanup is handled by context.subscriptions.
}
