/**
 * SCM input box interaction for Star Commit AI.
 *
 * Provides {@link setCommitMessage}, the single public entry point for writing
 * a generated commit message into the VS Code Source Control commit input box.
 * All access to the git repository state goes through the `vscode.git`
 * extension API so that the extension remains decoupled from direct git
 * binary invocations at the SCM layer.
 */

import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Minimal vscode.git extension type declarations
//
// The `vscode.git` built-in extension does not ship type definitions as part
// of the public `@types/vscode` package.  We declare only the subset of the
// API surface that this service needs.  When `src/git/gitService.ts` is
// implemented it may export its own copy of these types; at that point these
// declarations can be replaced with imports from that module.
// ---------------------------------------------------------------------------

/**
 * The writable commit-message input box displayed above the file-change list
 * in the Source Control panel.
 */
interface InputBox {
  /** Current text content of the SCM commit message input box. */
  value: string;
}

/**
 * A single git repository managed by the `vscode.git` extension.
 *
 * This is a strict subset of the full `Repository` interface; only the
 * `inputBox` property is required by this service.
 */
interface Repository {
  /** The SCM commit message input box associated with this repository. */
  readonly inputBox: InputBox;
}

/**
 * Subset of the `vscode.git` extension's public API (version 1).
 *
 * The full API exposes many more members; only the repositories list is
 * needed here.
 */
interface GitAPI {
  /**
   * All git repositories currently open in the workspace, in the order VS
   * Code discovered them.
   */
  readonly repositories: Repository[];
}

/**
 * Shape of the `exports` object returned by
 * `vscode.extensions.getExtension('vscode.git')`.
 */
interface GitExtension {
  /**
   * Returns a versioned handle to the git extension's public API.
   *
   * Pass `1` to request the stable v1 API surface.
   *
   * @param version - API version to request (currently only `1` is valid).
   * @returns The {@link GitAPI} instance for the requested version.
   */
  getAPI(version: 1): GitAPI;
}

// ---------------------------------------------------------------------------
// Public service function
// ---------------------------------------------------------------------------

/**
 * Writes `message` into the SCM commit input box of the selected repository.
 *
 * The function resolves the `vscode.git` extension at call time so it works
 * correctly even if the extension activates after Star Commit AI.
 *
 * @param message - The commit message text to place in the SCM input box.
 *   Must be a non-empty string; callers are responsible for validation.
 * @param repoIndex - Zero-based index into the list of open git repositories
 *   returned by the `vscode.git` API.  Defaults to `0` (the first / only
 *   repository).  Ignored when there are no repositories.
 * @returns `true` when the message was written successfully; `false` when the
 *   `vscode.git` extension is unavailable, not yet activated, or there are no
 *   open repositories.
 */
export async function setCommitMessage(
  message: string,
  repoIndex: number = 0,
): Promise<boolean> {
  /** Raw extension object returned by VS Code's extension registry. */
  const gitExtensionRaw = vscode.extensions.getExtension<GitExtension>("vscode.git");

  if (!gitExtensionRaw) {
    return false;
  }

  /**
   * Ensure the extension is fully activated before accessing its exports.
   * `activate()` is a no-op if the extension is already active.
   */
  const gitExtension: GitExtension = gitExtensionRaw.isActive
    ? gitExtensionRaw.exports
    : await gitExtensionRaw.activate();

  /** The v1 API handle from the git extension. */
  const gitApi: GitAPI = gitExtension.getAPI(1);

  if (gitApi.repositories.length === 0) {
    return false;
  }

  /** The repository whose input box will receive the generated message. */
  const repository: Repository = gitApi.repositories[repoIndex];

  if (!repository) {
    return false;
  }

  repository.inputBox.value = message;
  return true;
}
