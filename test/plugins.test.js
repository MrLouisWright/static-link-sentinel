import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { staticLinkSentinel } from '../src/vite.js';
import WebpackPluginESM from '../src/webpack.mjs';

const require = createRequire(import.meta.url);
const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url));
const quiet = { logger: { info() {} } };

test('vite plugin passes on a clean build and throws on a broken one', async () => {
  const ok = staticLinkSentinel();
  assert.equal(ok.apply, 'build');
  ok.configResolved({ root: fixtures, base: '/', build: { outDir: 'clean' }, ...quiet });
  await ok.closeBundle();
  const bad = staticLinkSentinel();
  bad.configResolved({ root: fixtures, base: '/', build: { outDir: 'broken' }, ...quiet });
  await assert.rejects(bad.closeBundle(), /static-link-sentinel: \d+ error/);
  const soft = staticLinkSentinel({ fail: false });
  soft.configResolved({ root: fixtures, base: '/', build: { outDir: 'broken' }, ...quiet });
  await soft.closeBundle();
});

test('vite plugin picks up base as basePath', async () => {
  const p = staticLinkSentinel();
  p.configResolved({ root: fixtures, base: '/docs/', build: { outDir: 'basepath' }, ...quiet });
  await assert.rejects(p.closeBundle(), /1 error/);
});

function fakeCompiler(outDir, publicPath) {
  let fn;
  return {
    context: fixtures,
    options: { output: { path: path.join(fixtures, outDir), publicPath } },
    hooks: { afterEmit: { tapPromise: (name, f) => { assert.equal(name, 'StaticLinkSentinelPlugin'); fn = f; } } },
    run: async () => { const c = { errors: [], warnings: [] }; await fn(c); return c; },
  };
}

test('webpack plugin (CJS require) reports compilation errors', async () => {
  const Plugin = require('../src/webpack.cjs');
  assert.equal(Plugin, Plugin.StaticLinkSentinelPlugin);
  const log = console.log; console.log = () => {};
  try {
    const c1 = fakeCompiler('broken', '/');
    new Plugin().apply(c1);
    const r1 = await c1.run();
    assert.equal(r1.errors.length, 1);
    const c2 = fakeCompiler('clean', 'auto');
    new WebpackPluginESM().apply(c2);
    assert.equal((await c2.run()).errors.length, 0);
    const c3 = fakeCompiler('broken', '/');
    new Plugin({ fail: false }).apply(c3);
    const r3 = await c3.run();
    assert.equal(r3.errors.length, 0);
    assert.equal(r3.warnings.length, 1);
  } finally { console.log = log; }
});

test('package exports map resolves for import and require', async () => {
  const pkg = require('../package.json');
  assert.equal(pkg.exports['./webpack'].require, './src/webpack.cjs');
  const m = await import('static-link-sentinel').catch(() => null);
  if (m) assert.equal(typeof m.check, 'function');
});
