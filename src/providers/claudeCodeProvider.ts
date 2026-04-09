/**
 * Claude Code CLI implementation of the {@link CommitMessageProvider} interface.
 *
 * This module invokes the `claude` executable (Claude Code CLI) as a child
 * process, pipes the full prompt to its stdin, and reads the generated commit
 * message from stdout. Diffs are never passed as CLI arguments to avoid shell
 * argument-length limits and escaping issues.
 */

import { spawn, execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CommitMessageProvider, GenerateOptions, ProviderModel } from "./types";

/**
 * Timeout in milliseconds for a single commit-message generation request.
 * If the Claude CLI does not produce output within this window the process
 * is killed and an error is thrown.
 */
const GENERATION_TIMEOUT_MS = 30_000;

/**
 * Default prompt template used when the caller does not supply a custom one.
 *
 * The literal `{diff}` token is replaced at runtime with the (possibly
 * truncated) diff string. The template instructs the model to follow the
 * Conventional Commits specification and to emit only the commit message —
 * no explanations, no markdown fences.
 */
const DEFAULT_PROMPT_TEMPLATE =
  "Generate a concise git commit message in {language} following the Conventional Commits " +
  "specification (e.g. feat, fix, chore, docs, refactor, test, style, perf). " +
  "Output ONLY the commit message — no explanations, no code fences, no extra text.\n\n" +
  "Git diff:\n{diff}";

/**
 * Cached resolved path to the `claude` binary. Computed once by
 * {@link resolveClaudePath} and reused for all subsequent spawn calls.
 */
let cachedClaudePath: string | null = null;

/**
 * Resolves the absolute path to the `claude` CLI binary.
 *
 * Checks in order:
 * 1. `which claude` via the user's login shell (picks up PATH from .zshrc/.bashrc)
 * 2. Known install locations: standalone installer paths (`~/.local/bin/claude`,
 *    `~/.claude/bin/claude`), Homebrew Apple Silicon (`/opt/homebrew/bin/claude`),
 *    Homebrew Intel / system npm global (`/usr/local/bin/claude`), Volta
 *    (`~/.volta/bin/claude`), and pnpm global (`~/.local/share/pnpm/claude`)
 * 3. npm global bin directory (npm global install)
 * 4. Falls back to bare `"claude"` without caching, allowing a retry on the
 *    next call (e.g. after the user installs the CLI without restarting VS Code)
 *
 * @returns The resolved path to the `claude` binary.
 */
function resolveClaudePath(): string {
  if (cachedClaudePath) {
    return cachedClaudePath;
  }

  // 1. Try resolving via the user's default shell (handles .zshrc/.bashrc PATH additions)
  const userShell = process.env.SHELL || "/bin/sh";
  try {
    const resolved = execFileSync(userShell, ["-lc", "which claude"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (resolved && existsSync(resolved)) {
      cachedClaudePath = resolved;
      return resolved;
    }
  } catch {
    // Shell lookup failed — try known paths
  }

  // 2. Known install locations across package managers and platforms
  const knownPaths = [
    join(homedir(), ".local", "bin", "claude"),        // Standalone installer (curl | bash)
    join(homedir(), ".claude", "bin", "claude"),        // Legacy standalone path
    "/opt/homebrew/bin/claude",                         // Homebrew Apple Silicon
    "/usr/local/bin/claude",                            // Homebrew Intel / system npm global
    join(homedir(), ".volta", "bin", "claude"),          // Volta
    join(homedir(), ".local", "share", "pnpm", "claude"), // pnpm global
  ];
  for (const knownPath of knownPaths) {
    if (existsSync(knownPath)) {
      cachedClaudePath = knownPath;
      return knownPath;
    }
  }

  // 3. npm global bin — try to discover it
  try {
    const npmBin = execFileSync("npm", ["bin", "-g"], {
      encoding: "utf8",
      timeout: 5000,
      shell: true,
    }).trim();
    const npmClaudePath = join(npmBin, "claude");
    if (existsSync(npmClaudePath)) {
      cachedClaudePath = npmClaudePath;
      return npmClaudePath;
    }
  } catch {
    // npm not available or failed
  }

  // 4. Fallback — bare command name
  return "claude"; // Don't cache — allow retry on next call
}

/**
 * The three Claude models exposed by this provider, ordered from most capable
 * to fastest.
 */
const CLAUDE_MODELS: readonly ProviderModel[] = [
  {
    id: "opus",
    displayName: "Claude Opus",
    isDefault: false,
  },
  {
    id: "sonnet",
    displayName: "Claude Sonnet",
    isDefault: true,
  },
  {
    id: "haiku",
    displayName: "Claude Haiku",
    isDefault: false,
  },
] as const;

/**
 * Implements {@link CommitMessageProvider} by invoking the Claude Code CLI.
 *
 * ### Process model
 * ```
 * spawn("claude", ["-p", "--model", <model>])
 *   └─ stdin  ← full prompt (with diff embedded)
 *   └─ stdout → generated commit message
 *   └─ stderr → error details on non-zero exit
 * ```
 *
 * ### Availability check
 * `isAvailable()` runs `claude --version` and returns `true` only when the
 * process exits with code 0. If the CLI is not on `PATH` the spawn will throw
 * `ENOENT`, which is caught and treated as unavailable.
 */
export class ClaudeCodeProvider implements CommitMessageProvider {
  /**
   * Stable machine-readable identifier for this provider.
   * Must match the `"claude-code"` enum value in the extension's
   * `starCommitAI.provider` setting.
   */
  public readonly id = "claude-code" as const;

  /**
   * Human-readable name displayed in Quick Pick menus and notifications.
   */
  public readonly displayName = "Claude Code CLI" as const;

  /**
   * Returns the ordered list of Claude models this provider supports.
   *
   * The array is a stable snapshot — callers must not mutate it.
   *
   * @returns Array of {@link ProviderModel} objects, with exactly one entry
   *   having `isDefault: true`.
   */
  public getModels(): ProviderModel[] {
    return [...CLAUDE_MODELS];
  }

  /**
   * Checks whether the Claude Code CLI is installed and reachable on `PATH`.
   *
   * If `resolveClaudePath()` returns an absolute path (i.e. the binary was
   * located via the shell, a known install location, or npm bin), the check
   * short-circuits immediately with `true` — the `existsSync` in
   * `resolveClaudePath` already confirmed the file exists.
   *
   * When the path could not be resolved (bare `"claude"` fallback), `claude
   * --version` is spawned and given 5 seconds to exit with code 0. This
   * avoids hanging indefinitely when the CLI triggers an auth prompt with no
   * TTY attached.
   *
   * @returns A promise that resolves to `true` when the CLI is available,
   *   `false` otherwise.
   */
  public isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const claudePath = resolveClaudePath();

      // If we resolved an absolute path (not bare "claude"), trust the existsSync check
      if (claudePath !== "claude") {
        resolve(true);
        return;
      }

      let child;
      try {
        child = spawn(claudePath, ["--version"], { stdio: "ignore" });
      } catch {
        // spawn itself can throw synchronously on some platforms when the
        // executable cannot be found before the async ENOENT event fires.
        resolve(false);
        return;
      }

      /** Timer that kills the child and resolves false if the CLI hangs. */
      const timeoutHandle = setTimeout(() => {
        child.kill();
        resolve(false);
      }, 5000);

      child.on("error", () => {
        clearTimeout(timeoutHandle);
        resolve(false);
      });
      child.on("close", (code) => {
        clearTimeout(timeoutHandle);
        resolve(code === 0);
      });
    });
  }

  /**
   * Generates a commit message for the supplied diff by invoking the Claude
   * Code CLI.
   *
   * @param diff - Raw git diff string to summarise. Truncated to
   *   `options.maxDiffLength` characters when specified.
   * @param model - The {@link ProviderModel.id} of the Claude model to use
   *   (e.g. `"sonnet"`, `"opus"`, `"haiku"`).
   * @param options - Additional generation parameters.
   * @param options.promptTemplate - Custom template. The tokens `{diff}` and
   *   `{language}` are replaced at runtime. Omit to use the built-in prompt.
   * @param options.maxDiffLength - Character cap applied to `diff` before it
   *   is embedded in the prompt. Defaults to `8000`.
   * @param options.language - Natural language for the output message.
   *   Defaults to `"english"`.
   * @returns A promise that resolves to the trimmed commit message string.
   * @throws An {@link Error} when the CLI process exits with a non-zero code,
   *   when the 30-second timeout is exceeded, or when stdin cannot be written.
   */
  public generateCommitMessage(
    diff: string,
    model: string,
    options: GenerateOptions,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      /** Language token substituted into the prompt template. */
      const language = options.language ?? "english";

      /** Diff content, optionally truncated to stay within context limits. */
      const truncatedDiff =
        typeof options.maxDiffLength === "number" && diff.length > options.maxDiffLength
          ? diff.slice(0, options.maxDiffLength)
          : diff;

      /** The full prompt sent to the model via stdin. */
      const prompt = buildPrompt(truncatedDiff, language, options.promptTemplate);

      /** AbortController used to enforce the generation timeout. */
      const controller = new AbortController();

      /** Timer handle for the 30-second generation timeout. */
      const timeoutHandle = setTimeout(() => {
        controller.abort();
        child.kill();
        reject(new Error("Commit message generation timed out after 30 seconds."));
      }, GENERATION_TIMEOUT_MS);

      const claudePath = resolveClaudePath();
      const child = spawn(claudePath, ["-p", "--model", model], {
        stdio: ["pipe", "pipe", "pipe"],
        signal: controller.signal,
      });

      /** Accumulated stdout chunks from the Claude CLI process. */
      const stdoutChunks: Buffer[] = [];

      /** Accumulated stderr chunks — captured for actionable error messages. */
      const stderrChunks: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timeoutHandle);

        if (err.code === "ENOENT") {
          reject(
            new Error(
              "Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code",
            ),
          );
        } else {
          reject(new Error(`Failed to start Claude CLI: ${err.message}`));
        }
      });

      child.on("close", (code: number | null) => {
        clearTimeout(timeoutHandle);

        if (code !== 0) {
          const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
          const detail = stderrText.length > 0 ? `: ${stderrText}` : "";
          reject(new Error(`Claude CLI exited with code ${code}${detail}`));
          return;
        }

        const message = Buffer.concat(stdoutChunks).toString("utf8").trim();
        resolve(message);
      });

      // Write the prompt to stdin and close the stream so the CLI knows input
      // is complete. This must happen after the event listeners are attached.
      child.stdin.write(prompt, "utf8", (writeErr) => {
        if (writeErr) {
          clearTimeout(timeoutHandle);
          child.kill();
          reject(new Error(`Failed to write prompt to Claude CLI stdin: ${writeErr.message}`));
          return;
        }

        child.stdin.end();
      });
    });
  }
}

/**
 * Constructs the full prompt string to send to the Claude CLI via stdin.
 *
 * Uses the caller-supplied `promptTemplate` when provided and non-empty;
 * otherwise falls back to {@link DEFAULT_PROMPT_TEMPLATE}. The tokens
 * `{diff}` and `{language}` are replaced with their runtime values.
 *
 * @param diff - The (possibly truncated) git diff string.
 * @param language - Natural language for the generated message (e.g. `"english"`).
 * @param promptTemplate - Optional custom template from extension settings.
 * @returns The fully resolved prompt string ready to be written to stdin.
 */
function buildPrompt(diff: string, language: string, promptTemplate?: string): string {
  const template =
    promptTemplate !== undefined && promptTemplate.trim().length > 0
      ? promptTemplate
      : DEFAULT_PROMPT_TEMPLATE;

  return template.replace("{diff}", diff).replace("{language}", language);
}
