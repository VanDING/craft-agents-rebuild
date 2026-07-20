const fs = require('fs');
const path = require('path');

const lockPath = path.resolve(__dirname, '..', 'bun.lock');
let content = fs.readFileSync(lockPath, 'utf-8');

const oldRefs = (content.match(/prosemirror-model@1\.25\.4/g) || []).length;
console.log('Found', oldRefs, 'references to prosemirror-model@1.25.4');

content = content.replace(
  /prosemirror-model@1\.25\.4/g,
  'prosemirror-model@1.25.11'
);
content = content.replace(
  /sha512-PIM7E43PBxKce8OQeezAs9j4TP\+5yDpZVbuurd1h5phUxEKIu\+G2a\+EUZzIC5nS1mJktDJWzbqS23n1tsAf5QA==/g,
  'sha512-QWg9RhnpLlogAmp3p96uEFrE5txQpFynd4vhBAELkwgOCWQs/X0yCzB3/hrHqiPwf91RG5KyWq6553zs9JqIOQ=='
);

const newRefs = (content.match(/prosemirror-model@1\.25\.11/g) || []).length;
console.log('Now', newRefs, 'references to prosemirror-model@1.25.11');

fs.writeFileSync(lockPath, content);
console.log('Lockfile updated successfully');
