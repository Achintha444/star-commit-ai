// @ts-check
"use strict";

/**
 * esbuild bundling script for the Star Commit AI VS Code extension.
 *
 * Usage:
 *   node esbuild.js              — development build (with source maps)
 *   node esbuild.js --production — production build (minified, no source maps)
 *   node esbuild.js --watch      — watch mode for iterative development
 */

const esbuild = require("esbuild");

/** Whether this is a production build (minified output). */
const isProduction = process.argv.includes("--production");

/** Whether to run in watch mode (rebuilds on file changes). */
const isWatch = process.argv.includes("--watch");

/**
 * Shared esbuild configuration for the extension bundle.
 *
 * @type {import("esbuild").BuildOptions}
 */
const buildOptions = {
  /** Extension entry point. */
  entryPoints: ["src/extension.ts"],

  /** Single-file output bundle. */
  bundle: true,

  /**
   * Output file — VS Code loads this as the extension entry.
   * Must match the "main" field in package.json.
   */
  outfile: "dist/extension.js",

  /**
   * `vscode` is provided by the VS Code runtime at activation time.
   * It must NOT be bundled — mark it as external.
   */
  external: ["vscode"],

  /**
   * CommonJS format is required by the VS Code extension host.
   */
  format: "cjs",

  /**
   * Node.js platform — extensions run in the VS Code Node.js host,
   * not in a browser environment.
   */
  platform: "node",

  /** Source maps aid debugging in development. Omit in production. */
  sourcemap: !isProduction,

  /** Minify output in production builds to reduce package size. */
  minify: isProduction,
};

/**
 * Run a development or production build, optionally in watch mode.
 *
 * @returns {Promise<void>}
 */
async function main() {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("[esbuild] Watching for changes...");
  } else {
    await esbuild.build(buildOptions);
    const mode = isProduction ? "production" : "development";
    console.log(`[esbuild] ${mode} build complete → dist/extension.js`);
  }
}

main().catch((err) => {
  console.error("[esbuild] Build failed:", err);
  process.exit(1);
});
