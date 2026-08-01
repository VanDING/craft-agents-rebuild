/**
 * i18n coverage check — every locale must contain every key present in the
 * reference locale (en). Fails with the list of missing keys.
 *
 * Usage: bun run scripts/check-i18n-coverage.ts
 * Part of validate:ci (lint:i18n:coverage).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES_DIR = join(import.meta.dir, '..', 'packages', 'shared', 'src', 'i18n', 'locales');
const REFERENCE = 'en.json';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flatten(value as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
const reference = JSON.parse(readFileSync(join(LOCALES_DIR, REFERENCE), 'utf-8')) as Record<string, unknown>;
const referenceKeys = new Set(flatten(reference));

let failed = false;
for (const file of files) {
  if (file === REFERENCE) continue;
  const locale = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf-8')) as Record<string, unknown>;
  const localeKeys = new Set(flatten(locale));
  const missing = [...referenceKeys].filter((k) => !localeKeys.has(k));
  if (missing.length > 0) {
    failed = true;
    console.error(`✗ ${file}: missing ${missing.length} keys vs ${REFERENCE}:`);
    for (const key of missing.slice(0, 20)) console.error(`    ${key}`);
    if (missing.length > 20) console.error(`    … and ${missing.length - 20} more`);
  } else {
    console.log(`✓ ${file}: covers all ${referenceKeys.size} keys`);
  }
}

if (failed) {
  console.error('i18n coverage check FAILED');
  process.exit(1);
}
console.log(`i18n coverage check passed (${files.length} locales, ${referenceKeys.size} reference keys)`);
