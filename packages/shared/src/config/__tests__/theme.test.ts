import { describe, expect, test } from 'bun:test';
import { themeToCSS, type ThemeOverrides } from '../theme.ts';
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
    expect(css).toContain('--theme-border-width: 2px;');
    expect(css).toContain('--theme-border-style: dashed;');
    expect(css).toContain('--font-sans: Inter, sans-serif;');
    expect(css).toContain('--font-size-base: 16px;');
    expect(css).toContain('--tracking-normal: 0.01em;');
    expect(css).toContain('--line-height-base: 1.6;');
    expect(css).toContain('--icon-stroke-width: 1.5;');
    expect(css).toContain('--icon-stroke-linecap: square;');
    expect(css).toContain('--spacing: 0.21875rem;');
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
});
