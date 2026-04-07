/**
 * Git service for Star Commit AI.
 *
 * Provides two capabilities:
 * - Repository discovery via the `vscode.git` extension API.
 * - Diff retrieval via `child_process.execFile` so the full diff text is
 *   available as a plain string, regardless of which {@link DiffMode} the
 *   user has configured.
 */

import * as vscode from 'vscode';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { DiffMode } from '../config/settings';

// ---------------------------------------------------------------------------
// Minimal inline typings for the vscode.git extension API.
// @types/vscode does not expose the git extension's public surface; these
// are the only shapes we rely on.
// ---------------------------------------------------------------------------

/**
 * The export type of the built-in `vscode.git` extension.
 *
 * Obtain a typed reference with:
 * ```typescript
 * vscode.extensions.getExtension<GitExtension>('vscode.git')
 * ```
 */
interface GitExtension {
  /**
   * Returns the public Git API at the requested version.
   *
   * @param version - API version to request. Always pass `1`.
   * @returns The {@link GitAPI} instance for the requested version.
   */
  getAPI(version: 1): GitAPI;
}

/**
 * Top-level object returned by {@link GitExtension.getAPI}.
 *
 * Exposes the list of repositories currently open in the workspace.
 */
interface GitAPI {
  /**
   * All git repositories discovered in the current VS Code workspace.
   * May be empty when no folder containing a `.git` directory is open.
   */
  readonly repositories: Repository[];
}

/**
 * Represents a single git repository managed by the built-in `vscode.git`
 * extension.
 */
interface Repository {
  /**
   * Absolute URI of the repository's root directory (the folder that
   * contains the `.git` directory).
   */
  readonly rootUri: vscode.Uri;

  /**
   * The SCM input box associated with this repository.
   * Setting {@link inputBox.value} populates the commit message field in the
   * Source Control panel.
   */
  readonly inputBox: {
    /** Current text in the SCM commit-message input box. */
    value: string;
  };
}

// ---------------------------------------------------------------------------
// Promisified execFile
// ---------------------------------------------------------------------------

/**
 * Promisified version of `child_process.execFile`.
 *
 * Used to invoke `git` as a subprocess and capture its stdout/stderr without
 * spawning a shell. Preferred over `exec` because arguments are passed as an
 * array and are never interpreted by a shell.
 */
const execFile = promisify(execFileCallback);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the list of git repositories open in the current VS Code workspace
 * by querying the built-in `vscode.git` extension API.
 *
 * The caller is responsible for handling the cases where:
 * - The extension is not installed or not enabled (returns `[]`).
 * - No git repository is open in the workspace (returns `[]`).
 * - Multiple repositories are open (caller should prompt the user to choose).
 *
 * @returns An array of {@link Repository} objects, possibly empty.
 */
export function getRepositories(): Repository[] {
  /** The built-in git extension, if present and activated. */
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');

  if (!gitExtension) {
    return [];
  }

  /** The typed public API exported by the git extension. */
  const api: GitAPI = gitExtension.exports.getAPI(1);

  return api.repositories;
}

/**
 * Reads the git diff for the given repository path using `child_process.execFile`.
 *
 * Behaviour by {@link DiffMode}:
 * - {@link DiffMode.All} — runs `git diff HEAD` to capture all changes
 *   (staged + unstaged) relative to the last commit. If `HEAD` does not exist
 *   (i.e. the repository has no commits yet), the command falls back to
 *   `git diff --cached` so that the initial staged snapshot is still returned.
 * - {@link DiffMode.Staged} — runs `git diff --cached` to capture only staged
 *   (indexed) changes.
 *
 * @param mode - Which changes to include; see {@link DiffMode}.
 * @param repoPath - Absolute filesystem path to the repository root. This is
 *   used as the `cwd` for the git subprocess so that git operates on the
 *   correct repository even when multiple workspaces are open.
 * @returns A promise that resolves to the full diff text (stdout). An empty
 *   string indicates no relevant changes were found.
 * @throws An error if git exits with a non-zero code for a reason other than a
 *   missing HEAD reference.
 */
export async function getDiff(mode: DiffMode, repoPath: string): Promise<string> {
  /** Shared options forwarded to every `execFile` call. */
  const execOptions = { cwd: repoPath };

  if (mode === DiffMode.Staged) {
    return runGitDiff(['diff', '--cached'], execOptions);
  }

  // DiffMode.All: prefer `git diff HEAD`; fall back when HEAD is absent.
  try {
    return await runGitDiff(['diff', 'HEAD'], execOptions);
  } catch (error) {
    if (isNoHeadError(error)) {
      // The repository exists but has no commits yet — fall back to the
      // staged snapshot so new files added with `git add` are still visible.
      return runGitDiff(['diff', '--cached'], execOptions);
    }

    // Any other error (corrupt repo, permission issue, etc.) is re-thrown
    // so the command orchestrator can surface it to the user.
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Invokes `git` with the supplied arguments and returns stdout as a string.
 *
 * @param args - Arguments passed directly to `git` (no shell interpolation).
 * @param options - Options forwarded to `execFile`, e.g. `{ cwd }`.
 * @returns A promise that resolves to the trimmed stdout string.
 * @throws The underlying `execFile` error on non-zero exit.
 */
async function runGitDiff(
  args: string[],
  options: { cwd: string },
): Promise<string> {
  const { stdout } = await execFile('git', args, options);
  return stdout;
}

/**
 * Returns `true` when the given error originates from git complaining that
 * `HEAD` does not exist — which happens in a brand-new repository with no
 * commits.
 *
 * Git emits one of the following messages in this situation:
 * - `"ambiguous argument 'HEAD'"`
 * - `"unknown revision or path not in the working tree"`
 *
 * @param error - The value caught from a failed `execFile` call.
 * @returns `true` if this is a "no HEAD" error; `false` for any other error.
 */
function isNoHeadError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  /** Lowercase error message for case-insensitive substring matching. */
  const message = error.message.toLowerCase();

  return (
    message.includes("ambiguous argument 'head'") ||
    message.includes('unknown revision or path not in the working tree')
  );
}
