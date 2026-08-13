import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCraftResourceLoader, setCraftSystemPrompt } from './craft-resource-loader.ts';

describe('createCraftResourceLoader', () => {
  it('returns the Craft prompt via systemPromptOverride after reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-loader-'));
    setCraftSystemPrompt('CRAFT_PROMPT');
    const loader = await createCraftResourceLoader({ cwd: dir, agentDir: join(dir, '.pi-agent') });
    expect(loader.getSystemPrompt()).toBe('CRAFT_PROMPT');
  });

  it('falls back to the base prompt when no Craft prompt is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-loader-'));
    setCraftSystemPrompt('');
    const loader = await createCraftResourceLoader({ cwd: dir, agentDir: join(dir, '.pi-agent') });
    expect(loader.getSystemPrompt()).toBeUndefined();
  });

  it('honors an injected getPrompt instead of the module-level prompt (ephemeral isolation)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-loader-'));
    setCraftSystemPrompt('MODULE_PROMPT');
    const loader = await createCraftResourceLoader({
      cwd: dir,
      agentDir: join(dir, '.pi-agent'),
      getPrompt: () => 'EPHEMERAL',
    });
    expect(loader.getSystemPrompt()).toBe('EPHEMERAL');
  });
});
