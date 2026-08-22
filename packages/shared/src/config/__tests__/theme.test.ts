import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BACKGROUND_HEX,
  DEFAULT_THEME_FILE,
  resolveTheme,
  resolveThemeMode,
  themeToCSS,
  type ThemeOverrides,
} from '../theme.ts';
import { validateThemeContent, validateThemeOverrideContent } from '../validators.ts';

describe('themeToCSS', () => {
  test('emits semantic and visual tokens from a theme file', () => {
    const theme: ThemeOverrides = {
      background: '#ffffff',
      foreground: '#111111',
      secondary: '#eeeeee',
      border: '#cccccc',
      radius: '12px',
      borderWidth: '2px',
      borderStyle: 'dashed',
      fontSans: 'Inter, sans-serif',
      fontSize: '16px',
      letterSpacing: '0.01em',
      lineHeight: 1.6,
      iconStrokeWidth: 1.5,
      iconStrokeLinecap: 'square',
      density: 'compact',
    };

    const css = themeToCSS(theme);

    expect(css).toContain('--secondary: #eeeeee;');
    expect(css).toContain('--border: #cccccc;');
    expect(css).toContain('--theme-radius: 12px;');
    expect(css).toContain('--theme-panel-radius: 12px;');
    expect(css).toContain('--theme-border-width: 2px;');
    expect(css).toContain('--theme-border-style: dashed;');
    expect(css).toContain('--font-sans: Inter, sans-serif;');
    expect(css).toContain('--font-size-base: 16px;');
    expect(css).toContain('--tracking-normal: 0.01em;');
    expect(css).toContain('--line-height-base: 1.6;');
    expect(css).toContain('--icon-stroke-width: 1.5;');
    expect(css).toContain('--icon-stroke-linecap: square;');
    expect(css).toContain('--theme-density: compact;');
    expect(css).toContain('--theme-density-scale: 0.875;');
    expect(css).toContain('--theme-row-padding-y: 0.625rem;');
    expect(css).toContain('--theme-menu-item-padding-y: 0.25rem;');
    expect(css).not.toContain('--spacing:');
  });

  test('expands each high-level depth preset', () => {
    for (const depth of ['flat', 'elevated', 'neon', 'glass', 'raised'] as const) {
      const css = themeToCSS({ depth, shadowColor: '#6633ff', shadowStrength: 0.2 });
      expect(css).toContain(`--theme-depth: ${depth};`);
      expect(css).toContain('--theme-shadow-color: #6633ff;');
      expect(css).toContain('--shadow-minimal:');
      expect(css).toContain('--shadow-middle:');
      expect(css).toContain('--shadow-strong:');
      expect(css).toContain('--shadow-modal-small:');
    }
  });

  test('glass depth exposes blur while other depths disable it', () => {
    expect(themeToCSS({ depth: 'glass', glassBlur: '28px' })).toContain(
      '--theme-backdrop-blur: 28px;'
    );
    expect(themeToCSS({ depth: 'flat', glassBlur: '28px' })).toContain(
      '--theme-backdrop-blur: 0px;'
    );
  });

  test('raised depth combines a hard border ring with zero-blur offset shadows', () => {
    const css = themeToCSS({ depth: 'raised', borderWidth: '2px', shadowColor: '#111111' });
    expect(css).toContain(
      '--shadow-minimal: 0 0 0 var(--theme-border-width) var(--border), 3px 3px 0 color-mix(in srgb, var(--theme-shadow-color) 10%, transparent);'
    );
  });

  test('keeps status colors in their original CSS syntax without parallel RGB channels', () => {
    const css = themeToCSS({
      info: 'oklch(0.8 0.15 90)',
      success: 'hsl(150 80% 40%)',
      destructive: 'rebeccapurple',
    });

    expect(css).toContain('--info: oklch(0.8 0.15 90);');
    expect(css).toContain('--success: hsl(150 80% 40%);');
    expect(css).toContain('--destructive: rebeccapurple;');
    expect(css).not.toContain('-rgb:');
  });

  test('leaves omitted surfaces and material tokens on the static Default baseline', () => {
    const css = themeToCSS({ accent: '#3366ff' });

    expect(css).toContain('--accent: #3366ff;');
    expect(css).not.toContain('--paper:');
    expect(css).not.toContain('--input:');
    expect(css).not.toContain('--theme-depth:');
    expect(css).not.toContain('--shadow-minimal:');
  });

  test('dark mode overrides visual tokens without losing light defaults', () => {
    const theme: ThemeOverrides = {
      background: '#ffffff',
      radius: '8px',
      depth: 'flat',
      dark: {
        background: '#111111',
        radius: '2px',
        depth: 'neon',
        shadowColor: '#00ffff',
      },
    };

    const darkCSS = themeToCSS(theme, true);
    expect(darkCSS).toContain('--background: #111111;');
    expect(darkCSS).toContain('--theme-radius: 2px;');
    expect(darkCSS).toContain('--theme-depth: neon;');
    expect(darkCSS).toContain('--theme-shadow-color: #00ffff;');
  });
});

describe('theme resolution', () => {
  test('deeply overlays a user theme onto the canonical default', () => {
    const resolved = resolveTheme({
      accent: '#123456',
      dark: { accent: '#abcdef' },
    });

    expect(resolved.background).toBe(DEFAULT_THEME_FILE.background);
    expect(resolved.accent).toBe('#123456');
    expect(resolved.dark?.background).toBe(DEFAULT_THEME_FILE.dark?.background);
    expect(resolved.dark?.accent).toBe('#abcdef');
  });

  test('normalizes both light-only and dark-only themes', () => {
    expect(resolveThemeMode({ supportedModes: ['light'] }, 'dark')).toBe('light');
    expect(resolveThemeMode({ supportedModes: ['dark'] }, 'light')).toBe('dark');
    expect(resolveThemeMode({ supportedModes: ['light', 'dark'] }, 'dark')).toBe('dark');
    expect(resolveThemeMode({ mode: 'scenic' }, 'light')).toBe('dark');
  });

  test('keeps the bundled default resource synchronized with the canonical snapshot', () => {
    const resourcePath = resolve(
      import.meta.dir,
      '../../../../../apps/electron/resources/themes/default.json'
    );
    const resourceTheme = JSON.parse(readFileSync(resourcePath, 'utf-8'));
    expect(resourceTheme).toEqual(DEFAULT_THEME_FILE);
  });

  test('keeps Electron startup backgrounds aligned with the Default CSS colors', () => {
    // Chromium canvas conversion of the canonical OKLCH backgrounds. These
    // values are used where Electron accepts a hex color but not CSS OKLCH.
    expect(BACKGROUND_HEX).toEqual({ light: '#f7f8fa', dark: '#080a10' });
  });

  test('keeps static CSS fallbacks synchronized with the canonical base colors', () => {
    const electronCSS = readFileSync(resolve(
      import.meta.dir,
      '../../../../../apps/electron/src/renderer/index.css'
    ), 'utf-8');
    const sharedUICSS = readFileSync(resolve(
      import.meta.dir,
      '../../../../ui/src/styles/index.css'
    ), 'utf-8');

    for (const css of [electronCSS, sharedUICSS]) {
      for (const key of ['background', 'foreground', 'accent', 'info', 'success', 'destructive'] as const) {
        expect(css).toContain(`--${key}: ${DEFAULT_THEME_FILE[key]};`);
        expect(css).toContain(`--${key}: ${DEFAULT_THEME_FILE.dark?.[key]};`);
      }
    }
  });
});

describe('theme validation', () => {
  test('accepts the expanded preset schema', () => {
    const result = validateThemeContent(JSON.stringify({
      name: 'Engine fixture',
      background: '#fff',
      foreground: '#111',
      depth: 'raised',
      radius: '0px',
      borderWidth: '2px',
      borderStyle: 'solid',
      density: 'cozy',
      dark: {
        background: '#111',
        foreground: '#fff',
        depth: 'neon',
      },
    }));

    expect(result.valid).toBe(true);
  });

  test('rejects unsupported values and CSS declaration injection', () => {
    expect(validateThemeOverrideContent(JSON.stringify({ depth: 'animated' })).valid).toBe(false);
    expect(validateThemeOverrideContent(JSON.stringify({ radius: '8px; color: red' })).valid).toBe(false);
    expect(validateThemeOverrideContent(JSON.stringify({ shadowStrength: 2 })).valid).toBe(false);
  });

  test('rejects unknown preset fields and ambiguous supported modes', () => {
    const base = { name: 'Strict fixture', accent: '#6633ff' };
    expect(validateThemeContent(JSON.stringify({ ...base, typoToken: '#fff' })).valid).toBe(false);
    expect(validateThemeContent(JSON.stringify({ ...base, supportedModes: [] })).valid).toBe(false);
    expect(validateThemeContent(JSON.stringify({ ...base, supportedModes: ['dark', 'dark'] })).valid).toBe(false);
  });
});
