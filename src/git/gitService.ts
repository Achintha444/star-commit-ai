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
import { promises as fs } from 'fs';
import * as path from 'path';
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
 *   (staged + unstaged) relative to the last commit, then appends synthetic
 *   unified-diff patches for every untracked file reported by
 *   `git ls-files --others --exclude-standard`. If `HEAD` does not exist
 *   (i.e. the repository has no commits yet), the command falls back to
 *   `git diff --cached` before appending untracked files.
 * - {@link DiffMode.Staged} — runs `git diff --cached` to capture only staged
 *   (indexed) changes. Untracked files are intentionally excluded.
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
  // In both branches we append synthetic patches for untracked files so that
  // brand-new files are visible to the AI even before they are staged.
  let trackedDiff: string;
  try {
    trackedDiff = await runGitDiff(['diff', 'HEAD'], execOptions);
  } catch (error) {
    if (isNoHeadError(error)) {
      // The repository exists but has no commits yet — fall back to the
      // staged snapshot so new files added with `git add` are still visible.
      trackedDiff = await runGitDiff(['diff', '--cached'], execOptions);
    } else {
      // Any other error (corrupt repo, permission issue, etc.) is re-thrown
      // so the command orchestrator can surface it to the user.
      throw error;
    }
  }

  /** Synthetic unified-diff patches for every untracked file. */
  const untrackedDiff = await getUntrackedFilesDiff(repoPath);

  return trackedDiff + untrackedDiff;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Maximum number of untracked files to include in the synthetic diff.
 *
 * Repositories with many generated or unignored artifacts can produce very
 * large lists. Capping the count keeps the diff within a reasonable size for
 * the AI context window and avoids stalling the extension.
 */
const MAX_UNTRACKED_FILES = 100;

/**
 * Builds a combined unified-diff string for every untracked (new, unstaged)
 * file in the repository.
 *
 * Steps:
 * 1. Run `git ls-files --others --exclude-standard` to obtain the list of
 *    files that git does not yet track and that are not covered by
 *    `.gitignore` rules.
 * 2. For each file (up to {@link MAX_UNTRACKED_FILES}), read its raw bytes
 *    from disk. Binary files (those containing a null byte) are silently
 *    skipped.
 * 3. Format the text content as a unified diff with `--- /dev/null` and
 *    `+++ b/<path>` headers so it resembles what `git diff --no-index`
 *    would produce, making it easy for the AI to interpret.
 *
 * Errors reading individual files are silently ignored so that one
 * inaccessible file does not abort the entire diff collection.
 *
 * @param repoPath - Absolute filesystem path to the repository root.
 * @returns A promise that resolves to the concatenated diff patches, or an
 *   empty string when there are no untracked text files.
 */
async function getUntrackedFilesDiff(repoPath: string): Promise<string> {
  /** Raw output of `git ls-files --others --exclude-standard`. */
  let lsOutput: string;
  try {
    const { stdout } = await execFile(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      { cwd: repoPath },
    );
    lsOutput = stdout;
  } catch {
    // If the command itself fails (e.g. not a git repo), return nothing.
    return '';
  }

  /** Newline-separated relative paths of untracked files. */
  const untrackedPaths = lsOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_UNTRACKED_FILES);

  if (untrackedPaths.length === 0) {
    return '';
  }

  /** Collected patches, one per readable text file. */
  const patches: string[] = [];

  for (const relativePath of untrackedPaths) {
    /** Absolute path on disk used for `fs.readFile`. */
    const absolutePath = path.join(repoPath, relativePath);

    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.readFile(absolutePath);
    } catch {
      // File may have been deleted between listing and reading — skip it.
      continue;
    }

    // Skip binary files: a null byte anywhere in the buffer is a reliable
    // heuristic that avoids garbled output and inflated diff sizes.
    if (fileBuffer.includes(0)) {
      continue;
    }

    /** UTF-8 decoded file content. */
    const content = fileBuffer.toString('utf8');

    patches.push(formatUntrackedFile(relativePath, content));
  }

  return patches.join('');
}

/**
 * Formats a single untracked file's content as a unified diff patch.
 *
 * The output mirrors the format produced by `git diff --no-index /dev/null
 * <file>` so that it is consistent with the tracked-file diff that precedes
 * it in the combined output sent to the AI.
 *
 * @param relativePath - Repository-relative path of the new file
 *   (e.g. `src/foo.ts`). Used in the diff headers.
 * @param content - Full UTF-8 text content of the file.
 * @returns A string containing the complete patch block for this file,
 *   always ending with a newline.
 */
function formatUntrackedFile(relativePath: string, content: string): string {
  /** Individual lines of the file, preserving empty lines. */
  const lines = content.split('\n');

  // When the file ends with a trailing newline, `split` produces an extra
  // empty string at the end that would generate a spurious `+` line.  Remove
  // it so the hunk line count is accurate.
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  /** Every content line prefixed with `+` as required by the unified format. */
  const diffLines = lines.map((line) => `+${line}`).join('\n');

  /** Hunk header: zero lines from /dev/null, all lines added. */
  const hunkHeader = `@@ -0,0 +1,${lines.length} @@`;

  return (
    `diff --git a/${relativePath} b/${relativePath}\n` +
    `new file mode 100644\n` +
    `--- /dev/null\n` +
    `+++ b/${relativePath}\n` +
    `${hunkHeader}\n` +
    `${diffLines}\n`
  );
}

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
