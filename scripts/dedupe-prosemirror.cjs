// scripts/dedupe-prosemirror.cjs — Postinstall deduplication fix
// Bun's hoisted linker creates nested copies of prosemirror-model
// at different versions, causing TS type conflicts.
// This script replaces all nested prosemirror-model copies with
// the root-level version.

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const rootModel = path.join(rootDir, 'node_modules', 'prosemirror-model');
const rootModelPkg = path.join(rootModel, 'package.json');

if (!fs.existsSync(rootModelPkg)) {
  console.log('[dedupe] Root prosemirror-model not found, skipping');
  process.exit(0);
}

const rootVersion = JSON.parse(fs.readFileSync(rootModelPkg, 'utf-8')).version;
console.log(`[dedupe] Root prosemirror-model: ${rootVersion}`);

// Find all nested prosemirror-model copies under node_modules/**/node_modules/prosemirror-model
function findNestedModels(dir, depth = 0) {
  if (depth > 4) return [];
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' && entry.isDirectory()) {
        const innerModel = path.join(dir, entry.name, 'prosemirror-model');
        if (fs.existsSync(innerModel)) {
          results.push(innerModel);
        }
      } else if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        results.push(...findNestedModels(path.join(dir, entry.name), depth + 1));
      }
    }
  } catch (e) {
    // Ignore permission errors
  }
  return results;
}

const nestedModels = findNestedModels(path.join(rootDir, 'node_modules'));

let fixed = 0;
for (const nested of nestedModels) {
  const nestedPkg = path.join(nested, 'package.json');
  if (!fs.existsSync(nestedPkg)) continue;
  
  const nestedVersion = JSON.parse(fs.readFileSync(nestedPkg, 'utf-8')).version;
  if (nestedVersion === rootVersion) continue; // already same version
  
  console.log(`[dedupe] Fixing ${nested} (${nestedVersion} → ${rootVersion})`);
  
  // Delete the nested copy and replace with root version
  fs.rmSync(nested, { recursive: true, force: true });
  
  // Recursively copy root model to nested location
  copyDirSync(rootModel, nested);
  fixed++;
}

console.log(`[dedupe] Fixed ${fixed} nested prosemirror-model copies`);

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
