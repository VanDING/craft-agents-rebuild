import { describe, expect, it } from 'bun:test';
import { piDriver, filterEnabledModels } from './pi.ts';

describe('piDriver.buildRuntime custom endpoint models', () => {
  it('preserves explicit per-model supportsImages values', () => {
    const runtime = piDriver.buildRuntime({
      context: {
        provider: 'pi',
        authType: 'api_key',
        resolvedModel: 'vision-model',
        capabilities: { needsHttpPoolServer: false },
        connection: {
          slug: 'custom-endpoint',
          name: 'Custom Endpoint',
          providerType: 'pi',
          authType: 'api_key',
          baseUrl: 'http://127.0.0.1:11111/v1',
          customEndpoint: { api: 'anthropic-messages', supportsImages: true },
          models: [
            { id: 'vision-model', contextWindow: 262_144, maxTokens: 32_768, supportsImages: true },
            { id: 'text-only-model', supportsImages: false },
            { id: 'thinking-model', supportsThinking: true, thinkingLevelMap: { max: 'max' } },
            { id: 'plain-model' },
          ],
          createdAt: Date.now(),
        } as any,
      },
      coreConfig: {} as any,
      hostRuntime: {} as any,
      resolvedPaths: {
        piServerPath: '/tmp/pi-agent-server.js',
        interceptorBundlePath: '/tmp/interceptor.cjs',
        nodeRuntimePath: '/usr/bin/node',
      },
    });

    expect(runtime.customModels).toEqual([
      { id: 'vision-model', contextWindow: 262_144, maxTokens: 32_768, supportsImages: true },
      { id: 'text-only-model', supportsImages: false },
      { id: 'thinking-model', supportsThinking: true, thinkingLevelMap: { max: 'max' } },
      'plain-model',
    ]);
  });
});

describe('filterEnabledModels (GitHub Copilot)', () => {
  // Fixture mirrors a real Individual-account /models response: the API
  // returns internal routing variants (mai-code-1-flash-4th / -picker /
  // -secondary / -tertiary) alongside the picker-marked entries.
  const raw = [
    { id: 'gpt-5.4-mini-free-auto', name: 'GPT-5.4 mini', policy: { state: 'enabled' }, modelPickerEnabled: true },
    { id: 'mai-code-1.1-flash', name: 'MAI-Code-1.1-Flash', policy: { state: 'enabled' }, modelPickerEnabled: true },
    { id: 'mai-code-1-flash-4th', name: 'MAI-Code-1.1-Flash', policy: { state: 'enabled' }, modelPickerEnabled: false },
    { id: 'mai-code-1-flash-picker', name: 'MAI-Code-1-Flash', policy: { state: 'enabled' }, modelPickerEnabled: false },
    { id: 'mai-code-1-flash-secondary', name: 'MAI-Code-1.1-Flash', policy: { state: 'enabled' }, modelPickerEnabled: false },
    { id: 'mai-code-1-flash-tertiary', name: 'MAI-Code-1.1-Flash', policy: { state: 'enabled' }, modelPickerEnabled: false },
    { id: 'mai-code-1-flash', name: 'MAI-Code-1-Flash', policy: { state: 'enabled' }, modelPickerEnabled: true },
    { id: 'gpt-5-mini', name: 'GPT-5 mini', policy: { state: 'enabled' }, modelPickerEnabled: true },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', policy: { state: 'enabled' }, modelPickerEnabled: true },
    { id: 'oswe-vscode-prime', name: 'Raptor mini', policy: { state: 'enabled' }, modelPickerEnabled: true },
  ];

  it('excludes internal routing variants, keeping only picker-marked models', () => {
    const ids = filterEnabledModels(raw).map(m => m.id);
    expect(ids).toEqual([
      'gpt-5.4-mini-free-auto',
      'mai-code-1.1-flash',
      'mai-code-1-flash',
      'gpt-5-mini',
      'claude-haiku-4.5',
      'oswe-vscode-prime',
    ]);
  });

  it('falls back to policy-enabled models when no picker flag is set', () => {
    const noPicker = raw.map(m => ({ ...m, modelPickerEnabled: false }));
    const ids = filterEnabledModels(noPicker).map(m => m.id);
    expect(ids).toContain('mai-code-1-flash-4th');
    expect(ids).toContain('claude-haiku-4.5');
    expect(ids).not.toContain('gpt-4.5'); // legacy prefix excluded
  });

  it('excludes legacy gpt-4/gpt-3.5 prefixes', () => {
    const legacy = [
      { id: 'gpt-4.5', name: 'GPT-4.5', policy: { state: 'enabled' }, modelPickerEnabled: true },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5', policy: { state: 'enabled' }, modelPickerEnabled: true },
      { id: 'gpt-5.4', name: 'GPT-5.4', policy: { state: 'enabled' }, modelPickerEnabled: true },
    ];
    expect(filterEnabledModels(legacy).map(m => m.id)).toEqual(['gpt-5.4']);
  });

  it('excludes picker-marked models whose policy is disabled', () => {
    const disabled = [
      { id: 'mai-code-1.1-flash', name: 'MAI', policy: { state: 'disabled' }, modelPickerEnabled: true },
      { id: 'gpt-5.4', name: 'GPT-5.4', policy: { state: 'enabled' }, modelPickerEnabled: true },
    ];
    expect(filterEnabledModels(disabled).map(m => m.id)).toEqual(['gpt-5.4']);
  });
});
