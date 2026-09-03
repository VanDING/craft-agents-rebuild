/**
 * Cross-platform asset copy script.
 *
 * Copies the resources/ directory to dist/resources/.
 * All bundled assets (docs, themes, permissions, tool-icons) now live in resources/
 * which electron-builder handles natively via directories.buildResources.
 *
 * At Electron startup, setBundledAssetsRoot(__dirname) is called, and then
 * getBundledAssetsDir('docs') resolves to <__dirname>/resources/docs/, etc.
 *
 * Run: bun scripts/copy-assets.ts
 */

import { cpSync, copyFileSync, rmSync } from 'fs';
import { join } from 'path';

// Copy all resources (icons, themes, docs, permissions, tool-icons, etc.)
// Remove the previous copy first so deleted source assets cannot survive as
// stale files in packaged builds.
rmSync('dist/resources', { recursive: true, force: true });
cpSync('resources', 'dist/resources', { recursive: true });

// CLI tools (wrappers, python scripts, platform uv binary) are staged by
// electron-builder via extraResources → <resources>/app/resources/{bin,scripts}
// so spawned child processes can execute them. Exclude them from the asar copy:
// an asar-virtual copy would otherwise duplicate ~80MB (uv.exe) and mislead
// path resolution (asar files are not executable by external processes).
rmSync('dist/resources/bin', { recursive: true, force: true });
rmSync('dist/resources/scripts', { recursive: true, force: true });

console.log('✓ Copied resources/ → dist/resources/ (excluded bin/ + scripts/, shipped via extraResources)');

// Copy PowerShell parser script (for Windows command validation in Explore mode)
// Source: packages/shared/src/agent/powershell-parser.ps1
// Destination: dist/resources/powershell-parser.ps1
const psParserSrc = join('..', '..', 'packages', 'shared', 'src', 'agent', 'powershell-parser.ps1');
const psParserDest = join('dist', 'resources', 'powershell-parser.ps1');
try {
  copyFileSync(psParserSrc, psParserDest);
  console.log('✓ Copied powershell-parser.ps1 → dist/resources/');
} catch (err) {
  // Only warn - PowerShell validation is optional on non-Windows platforms
  console.log('⚠ powershell-parser.ps1 copy skipped (not critical on non-Windows)');
}
