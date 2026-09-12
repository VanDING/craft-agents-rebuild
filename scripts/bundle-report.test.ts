import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('bundle budgets reject absent, unrecognized and missing assets and invalid limits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-bundle-report-'));
  const script = join(dir, 'scripts/bundle-report.ts');
  const dist = join(dir, 'apps/electron/dist');
  const invoke = (budget = '4800000') => Bun.spawnSync([process.execPath, script, '--check'], {
    env: { ...process.env, CRAFT_MAX_RENDERER_INITIAL_BYTES: budget }, stdout: 'pipe', stderr: 'pipe',
  }).exitCode;
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(join(import.meta.dir, 'bundle-report.ts'), script);
    expect(invoke()).not.toBe(0);
    mkdirSync(join(dist, 'resources/pi-agent-server'), { recursive: true });
    mkdirSync(join(dist, 'renderer/assets'), { recursive: true });
    writeFileSync(join(dist, 'main.cjs'), 'main');
    writeFileSync(join(dist, 'resources/pi-agent-server/bundle.js'), 'pi');
    writeFileSync(join(dist, 'renderer/index.html'), '<html></html>');
    expect(invoke()).not.toBe(0);
    writeFileSync(join(dist, 'renderer/index.html'), '<script src="./assets/index.js"></script>');
    expect(invoke()).not.toBe(0);
    writeFileSync(join(dist, 'renderer/assets/index.js'), 'renderer');
    expect(invoke()).toBe(0);
    expect(invoke('1')).not.toBe(0);
    expect(invoke('NaN')).not.toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
