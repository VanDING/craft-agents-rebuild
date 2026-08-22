import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const STORAGE_MODULE = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href;
const temporaryDirectories: string[] = [];

function makeConfigDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'craft-agent-theme-'));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, 'themes'), { recursive: true });
  return directory;
}

function runStorageScript(configDir: string, script: string): unknown {
  const result = Bun.spawnSync([process.execPath, '--eval', script], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(`Theme storage subprocess failed:\n${result.stderr.toString()}`);
  }
  const output = result.stdout.toString().trim().split('\n').at(-1);
  return JSON.parse(output || 'null');
}

function validTheme(name: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name, accent: '#6633ff', ...extra }, null, 2);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('user theme storage', () => {
  test('lists only confined valid user themes and keeps Default immutable', () => {
    const configDir = makeConfigDir();
    const themesDir = join(configDir, 'themes');
    writeFileSync(join(themesDir, 'alpha.json'), validTheme('Alpha'));
    writeFileSync(join(themesDir, 'default.json'), validTheme('Shadow Default'));
    writeFileSync(join(themesDir, 'invalid.json'), validTheme('Invalid', { unknownToken: true }));

    const outsideTheme = join(configDir, 'outside.json');
    writeFileSync(outsideTheme, validTheme('Outside'));
    try {
      symlinkSync(outsideTheme, join(themesDir, 'linked.json'));
    } catch {
      // Some Windows CI environments do not grant symlink privileges. The
      // confinement assertion still runs everywhere else.
    }

    const result = runStorageScript(configDir, `
      import {
        isValidUserThemeId,
        loadPresetTheme,
        loadPresetThemes,
      } from '${STORAGE_MODULE}';
      const builtin = loadPresetTheme('default');
      console.log(JSON.stringify({
        ids: loadPresetThemes().map((theme) => theme.id),
        builtinName: builtin?.theme.name,
        builtinPath: builtin?.path,
        traversal: loadPresetTheme('../outside'),
        validIds: [
          isValidUserThemeId('nord-2'),
          isValidUserThemeId('default'),
          isValidUserThemeId('Default'),
          isValidUserThemeId('../outside'),
        ],
      }));
    `) as {
      ids: string[];
      builtinName: string;
      builtinPath: string;
      traversal: unknown;
      validIds: boolean[];
    };

    expect(result.ids).toEqual(['alpha']);
    expect(result.builtinName).toBe('Default');
    expect(result.builtinPath).toBe('builtin:default');
    expect(result.traversal).toBeNull();
    expect(result.validIds).toEqual([true, false, false, false]);
  });

  test('confines local scenic assets and only materializes the selected image', () => {
    const configDir = makeConfigDir();
    const themesDir = join(configDir, 'themes');
    writeFileSync(join(themesDir, 'inside.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(configDir, 'outside.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(themesDir, 'safe.json'), validTheme('Safe', {
      mode: 'scenic',
      backgroundImage: 'inside.png',
    }));
    writeFileSync(join(themesDir, 'escape.json'), validTheme('Escape', {
      mode: 'scenic',
      backgroundImage: '../outside.png',
    }));

    const result = runStorageScript(configDir, `
      import { loadPresetTheme, loadPresetThemes } from '${STORAGE_MODULE}';
      const listed = loadPresetThemes();
      console.log(JSON.stringify({
        listHasPayload: listed.some((theme) => 'theme' in theme || 'backgroundImage' in theme),
        safeImage: loadPresetTheme('safe')?.theme.backgroundImage,
        escapedImage: loadPresetTheme('escape')?.theme.backgroundImage ?? null,
      }));
    `) as { listHasPayload: boolean; safeImage: string; escapedImage: string | null };

    expect(result.listHasPayload).toBe(false);
    expect(result.safeImage).toStartWith('data:image/png;base64,');
    expect(result.escapedImage).toBeNull();
  });

  test('migrates the deprecated override once without deleting the source', () => {
    const configDir = makeConfigDir();
    const legacyPath = join(configDir, 'theme.json');
    writeFileSync(legacyPath, JSON.stringify({ accent: '#123456' }, null, 2));

    const result = runStorageScript(configDir, `
      import { initializeThemeStorage } from '${STORAGE_MODULE}';
      import { readdirSync } from 'node:fs';
      import { join } from 'node:path';
      initializeThemeStorage();
      initializeThemeStorage();
      const themesDir = join(${JSON.stringify(configDir)}, 'themes');
      console.log(JSON.stringify(readdirSync(themesDir).sort()));
    `) as string[];

    expect(result).toEqual(['.legacy-theme-json-migrated', 'migrated-custom.json']);
    expect(existsSync(legacyPath)).toBe(true);
    const migrated = JSON.parse(readFileSync(join(configDir, 'themes', 'migrated-custom.json'), 'utf-8'));
    expect(migrated.name).toBe('Migrated Custom Theme');
    expect(migrated.accent).toBe('#123456');
  });

  test('uses config.json as the authoritative preference store', () => {
    const configDir = makeConfigDir();
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [],
      activeWorkspaceId: null,
      activeSessionId: null,
    }, null, 2));
    writeFileSync(join(configDir, 'config-defaults.json'), JSON.stringify({
      version: '1.0',
      description: 'Test defaults',
      defaults: { colorTheme: 'default' },
      workspaceDefaults: {
        permissionMode: 'ask',
        cyclablePermissionModes: ['safe', 'ask', 'allow-all'],
      },
    }, null, 2));

    const result = runStorageScript(configDir, `
      import { getThemePreferences, setThemePreferences } from '${STORAGE_MODULE}';
      const initial = getThemePreferences();
      const persisted = setThemePreferences({
        mode: 'dark',
        colorTheme: '../escape',
        font: 'system',
      });
      console.log(JSON.stringify({ initial, persisted, reloaded: getThemePreferences() }));
    `) as {
      initial: { mode: string; colorTheme: string; font: string };
      persisted: { mode: string; colorTheme: string; font: string };
      reloaded: { mode: string; colorTheme: string; font: string };
    };

    expect(result.initial).toEqual({ mode: 'system', colorTheme: 'default', font: 'theme' });
    expect(result.persisted).toEqual({ mode: 'dark', colorTheme: 'default', font: 'system' });
    expect(result.reloaded).toEqual(result.persisted);
    const rawConfig = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'));
    expect(rawConfig.themeMode).toBe('dark');
    expect(rawConfig.colorTheme).toBe('default');
    expect(rawConfig.themeFont).toBe('system');
  });
});
