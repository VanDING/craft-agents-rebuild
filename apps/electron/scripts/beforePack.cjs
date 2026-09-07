const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

/** Provision the pinned Bun and uv for the actual packaging target, including cross-builds. */
module.exports = async function beforePack(context) {
  // electron-builder Arch enum: x64 = 1, arm64 = 3.
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch];
  if (!arch) throw new Error(`Unsupported packaging architecture: ${context.arch}`);
  const rootDir = resolve(context.packager.projectDir, '../..');
  execFileSync('bun', ['run', 'scripts/provision-runtime.ts', context.electronPlatformName, arch], {
    cwd: rootDir,
    stdio: 'inherit',
  });
};
