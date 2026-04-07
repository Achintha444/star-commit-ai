/**
 * Claude Code CLI implementation of the {@link CommitMessageProvider} interface.
 *
 * This module invokes the `claude` executable (Claude Code CLI) as a child
 * process, pipes the full prompt to its stdin, and reads the generated commit
 * message from stdout. Diffs are never passed as CLI arguments to avoid shell
 * argument-length limits and escaping issues.
 */

import { spawn } from "child_process";
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
   * Spawns `claude --version` and resolves to `true` if the process exits
   * with code 0. Any spawn error (e.g. `ENOENT`) or non-zero exit code
   * resolves to `false`.
   *
   * @returns A promise that resolves to `true` when the CLI is available,
   *   `false` otherwise.
   */
  public isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let child;

      try {
        child = spawn("claude", ["--version"], { stdio: "ignore" });
      } catch {
        // spawn itself can throw synchronously on some platforms when the
        // executable cannot be found before the async ENOENT event fires.
        resolve(false);
        return;
      }

      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
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

      const child = spawn("claude", ["-p", "--model", model], {
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
