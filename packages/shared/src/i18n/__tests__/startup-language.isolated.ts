import { expect, test } from 'bun:test';
import { setupI18n, whenI18nReady, changeAppLanguage } from '../setupI18n';

test('loads detected Chinese before startup language synchronization', async () => {
  const instance = setupI18n([{
    type: 'languageDetector', init() {}, detect() { return 'zh-Hans'; }, cacheUserLanguage() {},
  }]);
  expect(instance.language).toBe('zh-Hans');
  await whenI18nReady();
  expect(instance.hasResourceBundle('zh-Hans', 'translation')).toBe(true);
  expect(instance.resolvedLanguage).toBe('zh-Hans');
  await changeAppLanguage('ja');
  expect(instance.resolvedLanguage).toBe('ja');
});
