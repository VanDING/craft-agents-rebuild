/**
 * Cross-platform main process build script
 * Loads .env and passes OAuth defines to esbuild
 */

import { spawn } from "bun";
import * as esbuild from "esbuild";
import { existsSync, readFileSync, statSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");
const DIST_DIR = join(ROOT_DIR, "apps/electron/dist");
const OUTPUT_FILE = join(DIST_DIR, "main.cjs");
const INTERCEPTOR_SOURCE = join(ROOT_DIR, "packages/shared/src/unified-network-interceptor.ts");
const INTERCEPTOR_OUTPUT = join(DIST_DIR, "interceptor.cjs");
const SESSION_TOOLS_CORE_DIR = join(ROOT_DIR, "packages/session-tools-core");
const PI_AGENT_SERVER_DIR = join(ROOT_DIR, "packages/pi-agent-server");
const PI_AGENT_SERVER_OUTPUT = join(PI_AGENT_SERVER_DIR, "dist/index.js");
const PI_AGENT_SERVER_BUNDLE = join(PI_AGENT_SERVER_DIR, "dist/bundle.js");
const WA_WORKER_DIR = join(ROOT_DIR, "packages/messaging-whatsapp-worker");
const WA_WORKER_SOURCE = join(WA_WORKER_DIR, "src/worker.ts");
const WA_WORKER_OUTPUT = join(WA_WORKER_DIR, "dist/worker.cjs");

// Load .env file if it exists
function loadEnvFile(): void {
  const envPath = join(ROOT_DIR, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim();
          let value = trimmed.slice(eqIndex + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
        }
      }
    }
  }
}

function getBuildDefines(): Record<string, string> {
  const definedVars = [
    "SLACK_OAUTH_CLIENT_ID",
    "SLACK_OAUTH_CLIENT_SECRET",
    "MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_SECRET",
    "SENTRY_ELECTRON_INGEST_URL",
    "CRAFT_DEV_RUNTIME",
  ];

  const defines: Record<string, string> = {};
  for (const varName of definedVars) {
    const value = process.env[varName] || "";
    // JSON.stringify renders the value as a string literal, not an identifier.
    defines[`process.env.${varName}`] = JSON.stringify(value);
  }
  return defines;
}

// Verify a JavaScript file is syntactically valid
async function verifyJsFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
  if (!existsSync(filePath)) {
    return { valid: false, error: "File does not exist" };
  }

  const stats = statSync(filePath);
  if (stats.size === 0) {
    return { valid: false, error: "File is empty" };
  }

  const proc = spawn({
    cmd: ["node", "--check", filePath],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    return { valid: false, error: stderr || "Syntax error" };
  }

  return { valid: true };
}

// Verify Session Tools Core package exists (raw TypeScript, bundled by consumers)
// No build step needed - it exports TypeScript directly like other packages
function verifySessionToolsCore(): void {
  console.log("🔍 Verifying Session Tools Core...");

  // Verify source exists
  const sourceFile = join(SESSION_TOOLS_CORE_DIR, "src/index.ts");
  if (!existsSync(sourceFile)) {
    console.error("❌ Session tools core source not found at", sourceFile);
    process.exit(1);
  }

  console.log("✅ Session tools core verified");
}

// Build the unified network interceptor (bundled CJS loaded via --require into Node-based SDK subprocesses)
async function buildInterceptor(): Promise<void> {
  console.log("🔌 Building unified network interceptor...");

  const proc = spawn({
    cmd: [
      "bun", "run", "esbuild",
      INTERCEPTOR_SOURCE,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      `--outfile=${INTERCEPTOR_OUTPUT}`,
    ],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error("❌ Interceptor build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  if (!existsSync(INTERCEPTOR_OUTPUT)) {
    console.error("❌ Interceptor output not found at", INTERCEPTOR_OUTPUT);
    process.exit(1);
  }

  console.log("✅ Interceptor built successfully");
}

// Build the Pi Agent Server (subprocess for Pi SDK sessions)
// Optional: skips if package directory is missing (e.g., not synced to OSS).
async function buildPiAgentServer(): Promise<void> {
  if (!existsSync(join(PI_AGENT_SERVER_DIR, "src"))) {
    console.log("⏭️  Pi agent server skipped (package not found)");
    return;
  }

  console.log("🥧 Building Pi Agent Server...");

  // Ensure dist directory exists
  const distDir = join(PI_AGENT_SERVER_DIR, "dist");
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  // Package build script emits dist/bundle.js (SDK) + thin dist/index.js
  // launcher. Direct single-file bundles trip Pi 0.85+ entry guards.
  const proc = spawn({
    cmd: ["bun", "run", "build"],
    cwd: PI_AGENT_SERVER_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error("❌ Pi agent server build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  // Verify outputs exist (launcher + bundle)
  if (!existsSync(PI_AGENT_SERVER_OUTPUT) || !existsSync(PI_AGENT_SERVER_BUNDLE)) {
    console.error("❌ Pi agent server output not found at", PI_AGENT_SERVER_OUTPUT, "or", PI_AGENT_SERVER_BUNDLE);
    process.exit(1);
  }

  console.log("✅ Pi agent server built successfully");

  // Copy to Electron resources so it gets picked up by electron:build:resources
  const resourcesDest = join(ROOT_DIR, "apps", "electron", "resources", "pi-agent-server");
  mkdirSync(resourcesDest, { recursive: true });

  // Remove stale legacy artifacts from earlier build layouts so they don't
  // ship inside the asar/extraResources. electron-builder packages the
  // extraResources entry from dist/resources/pi-agent-server (populated by
  // copy-assets.ts, which merges without cleaning), so BOTH the source and
  // the staged dist copy must be purged.
  const staleArtifacts = ["index.js.fork"];
  for (const root of [resourcesDest, join(ROOT_DIR, "apps", "electron", "dist", "resources", "pi-agent-server")]) {
    for (const stale of staleArtifacts) {
      const stalePath = join(root, stale);
      if (existsSync(stalePath)) {
        rmSync(stalePath);
        console.log(`  Removed stale artifact: ${stalePath.replace(`${ROOT_DIR}/`, "")}`);
      }
    }
  }

  copyFileSync(PI_AGENT_SERVER_OUTPUT, join(resourcesDest, "index.js"));
  console.log("  → Copied to resources/pi-agent-server/index.js");
  copyFileSync(PI_AGENT_SERVER_BUNDLE, join(resourcesDest, "bundle.js"));
  console.log("  → Copied to resources/pi-agent-server/bundle.js");
}

// Build the WhatsApp worker (Baileys-backed subprocess spawned by WhatsAppAdapter)
async function buildWhatsAppWorker(): Promise<void> {
  if (!existsSync(WA_WORKER_SOURCE)) {
    console.log("⏭️  WhatsApp worker skipped (package not found)");
    return;
  }

  console.log("📨 Building WhatsApp worker...");

  const workerDistDir = join(WA_WORKER_DIR, "dist");
  if (!existsSync(workerDistDir)) {
    mkdirSync(workerDistDir, { recursive: true });
  }

  // Baileys is bundled INTO worker.cjs (not external) so the packaged app is
  // self-contained. Dynamic `import('@whiskeysockets/baileys')` is resolved
  // at bundle time because the specifier is a literal.
  const proc = spawn({
    cmd: [
      "bun", "run", "esbuild",
      WA_WORKER_SOURCE,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node20",
      `--outfile=${WA_WORKER_OUTPUT}`,
      "--external:electron",
      "--external:node-pty",
      // Baileys' runtime-optional features — wrapped in try/catch at the
      // call site and not used by Craft Agent (we send text + documents, no
      // link previews, no inline image processing, no terminal QR).
      "--external:link-preview-js",
      "--external:qrcode-terminal",
      "--external:sharp",
      "--external:@img/sharp-*",
      "--external:jimp",
    ],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("❌ WhatsApp worker build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  if (!existsSync(WA_WORKER_OUTPUT)) {
    console.error("❌ WhatsApp worker output not found at", WA_WORKER_OUTPUT);
    process.exit(1);
  }

  console.log("✅ WhatsApp worker built successfully");
}

async function main(): Promise<void> {
  loadEnvFile();

  // Ensure dist directory exists
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  // Verify session tools core exists (shared utilities for session-scoped tools)
  verifySessionToolsCore();

  // Build Pi agent server (subprocess for Pi SDK sessions)
  await buildPiAgentServer();

  // Build unified network interceptor (CJS bundle for Node.js --require)
  await buildInterceptor();

  // Build WhatsApp worker (Baileys subprocess — optional package)
  await buildWhatsAppWorker();

  const buildDefines = getBuildDefines();

  console.log("🔨 Building main process...");

  // Use the esbuild JS API (not the CLI): bun 1.4 refuses to pass arguments
  // containing cmd.exe special characters to .cmd shims, which the quoted
  // --define values triggered on Windows.
  try {
    await esbuild.build({
      entryPoints: ["apps/electron/src/main/index.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: "apps/electron/dist/main.cjs",
      external: ["electron"],
      // Replace grammY's bundled polyfills (node-fetch@2 + abort-controller@3)
      // with native Node globals. esbuild otherwise renames the polyfill's
      // `class AbortSignal` to `_AbortSignal` to dodge collision with the
      // global, which then breaks node-fetch@2's `constructor.name` check and
      // fails every Telegram API call with a TypeError.
      alias: {
        "node-fetch": join(ROOT_DIR, "apps/electron/src/main/shims/node-fetch.cjs"),
        "abort-controller": join(ROOT_DIR, "apps/electron/src/main/shims/abort-controller.cjs"),
      },
      define: buildDefines,
      logLevel: "warning",
    });
  } catch (err) {
    console.error("❌ esbuild failed:", (err as Error).message);
    process.exit(1);
  }

  // Verify the output
  console.log("🔍 Verifying build output...");
  const verification = await verifyJsFile(OUTPUT_FILE);

  if (!verification.valid) {
    console.error("❌ Build verification failed:", verification.error);
    process.exit(1);
  }

  console.log("✅ Build complete and verified");
  process.exit(0);
}

main();
