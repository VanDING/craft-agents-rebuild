#!/usr/bin/env bun
/**
 * Bundle size report/regression check.
 *
 * Reports the bytes the packaged app actually ships for the initial renderer
 * graph and the main process. Targets live in docs/performance-*; the
 * `--check` thresholds here prevent silent regressions until the optimization
 * targets are reached.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const RENDERER = join(ROOT, 'apps', 'electron', 'dist', 'renderer');
const MAIN = join(ROOT, 'apps', 'electron', 'dist', 'main.cjs');
const PI_BUNDLE = join(ROOT, 'apps', 'electron', 'dist', 'resources', 'pi-agent-server', 'bundle.js');

function gzipSize(path: string): number {
  return gzipSync(readFileSync(path)).byteLength;
}

function initialRendererFiles(): string[] {
  const htmlPath = join(RENDERER, 'index.html');
  if (!existsSync(htmlPath)) return [];
  const html = readFileSync(htmlPath, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.js)"/g)].map((match) => match[1]!);
  return [...new Set(refs)].map((ref) => join(RENDERER, ref)).filter((file) => existsSync(file));
}

const rendererFiles = initialRendererFiles();
const rendererRaw = rendererFiles.reduce((sum, file) => sum + statSync(file).size, 0);
const rendererGzip = rendererFiles.reduce((sum, file) => sum + gzipSize(file), 0);
const mainRaw = existsSync(MAIN) ? statSync(MAIN).size : 0;
const mainGzip = existsSync(MAIN) ? gzipSize(MAIN) : 0;
const piRaw = existsSync(PI_BUNDLE) ? statSync(PI_BUNDLE).size : 0;

console.log('Bundle report');
console.log(`  renderer initial: ${(rendererRaw / 1024 / 1024).toFixed(2)} MB raw, ${(rendererGzip / 1024 / 1024).toFixed(2)} MB gzip (${rendererFiles.length} chunks)`);
console.log(`  main.cjs:         ${(mainRaw / 1024 / 1024).toFixed(2)} MB raw, ${(mainGzip / 1024 / 1024).toFixed(2)} MB gzip`);
console.log(`  pi bundle:        ${(piRaw / 1024 / 1024).toFixed(2)} MB raw`);

if (process.argv.includes('--check')) {
  const maxRendererRaw = Number(process.env.CRAFT_MAX_RENDERER_INITIAL_BYTES ?? 9_500_000);
  const maxMainRaw = Number(process.env.CRAFT_MAX_MAIN_BYTES ?? 50_000_000);
  const failures: string[] = [];
  if (rendererRaw > maxRendererRaw) failures.push(`renderer initial ${rendererRaw} > ${maxRendererRaw}`);
  if (mainRaw > maxMainRaw) failures.push(`main.cjs ${mainRaw} > ${maxMainRaw}`);
  if (failures.length > 0) {
    console.error(`Bundle regression budget exceeded:\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log('Bundle regression budgets OK');
}
