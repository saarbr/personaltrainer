const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
test('published site resolves local browser assets and excludes server/dependency files', () => {
  require('../scripts/build.cjs');
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'dist');
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const ref = match[1];
    if (/^(https?:|data:|#|javascript:)/.test(ref) || ref.includes("'+")) continue;
    assert.ok(fs.existsSync(path.join(output, ref.replace(/^\//, '').split('?')[0])), ref);
  }
  for (const file of fs.readdirSync(output)) {
    assert.ok(/\.(html|css|js|mp4)$/.test(file));
    assert.deepEqual(fs.readFileSync(path.join(output, file)), fs.readFileSync(path.join(root, file)));
  }
  for (const forbidden of ['node_modules', 'netlify', 'tests', 'package.json', 'package-lock.json', 'firestore.rules', '.env', 'JARVIS-FOUNDATION.md']) assert.equal(fs.existsSync(path.join(output, forbidden)), false);
});
