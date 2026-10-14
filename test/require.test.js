import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const fx = (n) => path.join(pkgRoot, 'test/fixtures', n);

test('require() and import() both expose check()', async () => {
  const cjs = require('../dist/index.cjs');
  assert.equal(typeof cjs.check, 'function');
  assert.equal(typeof cjs.default, 'function');
  const esm = await import('../src/index.js');
  assert.equal(typeof esm.check, 'function');
  const r1 = await cjs.check({ dir: fx('clean') });
  const r2 = await esm.check({ dir: fx('clean') });
  assert.deepEqual(r1.findings, r2.findings);
});

test('require() vite plugin entry', () => {
  const vite = require('../dist/vite.cjs');
  assert.equal(typeof vite.staticLinkSentinel, 'function');
});
