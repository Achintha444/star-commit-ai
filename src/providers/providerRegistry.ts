/**
 * Provider registry for Star Commit AI.
 *
 * The registry acts as a central store for all registered
 * {@link CommitMessageProvider} instances. It is populated during extension
 * activation and queried by the command orchestrator to look up the provider
 * selected in the user's settings.
 */

import type { CommitMessageProvider } from "./types";

/**
 * Central registry that holds all registered {@link CommitMessageProvider}
 * instances, keyed by their stable {@link CommitMessageProvider.id}.
 *
 * ### Typical usage
 * ```typescript
 * // During activate()
 * const registry = new ProviderRegistry();
 * registry.register(new ClaudeCodeProvider());
 *
 * // During command execution
 * const provider = registry.get("claude-code");
 * if (!provider) { throw new Error("Provider not found"); }
 * ```
 */
export class ProviderRegistry {
  /**
   * Internal map from provider ID to provider instance.
   *
   * Using a `Map` guarantees O(1) lookup by ID and preserves insertion order
   * when iterating via {@link getAll}.
   */
  private readonly providers: Map<string, CommitMessageProvider> = new Map();

  /**
   * Registers a provider with the registry.
   *
   * If a provider with the same {@link CommitMessageProvider.id} was
   * previously registered, it is silently replaced with the new instance.
   * This allows callers to hot-swap implementations without clearing the
   * entire registry.
   *
   * @param provider - The provider instance to register. Its `id` property
   *   is used as the map key.
   */
  public register(provider: CommitMessageProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Retrieves a previously registered provider by its stable ID.
   *
   * @param id - The {@link CommitMessageProvider.id} to look up
   *   (e.g. `"claude-code"`).
   * @returns The matching {@link CommitMessageProvider} instance, or
   *   `undefined` if no provider with that ID has been registered.
   */
  public get(id: string): CommitMessageProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Returns all registered providers as an array.
   *
   * The order reflects the insertion order of calls to {@link register}.
   * The returned array is a snapshot — mutations to it do not affect the
   * registry.
   *
   * @returns An array of all {@link CommitMessageProvider} instances currently
   *   held in the registry. Returns an empty array when no providers have been
   *   registered.
   */
  public getAll(): CommitMessageProvider[] {
    return [...this.providers.values()];
  }
}
