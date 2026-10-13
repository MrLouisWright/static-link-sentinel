import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { check, shouldFail, toMarkdown, toSarif, pretty } from '../src/index.js';

const fx = (n) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
const find = (r, rule, url) => r.findings.find((f) => f.ruleId === rule && (!url || f.url === url));

test('broken fixture: every rule fires where expected', async () => {
  const r = await check({ dir: fx('broken'), siteUrl: 'https://mysite.com', orphans: true });
  assert.equal(find(r, 'broken-link', '/blog/post-l/').fix, 'did you mean /blog/post-1/?');
  assert.equal(find(r, 'broken-link', '/blog/post-l/').line, 21);
  assert.ok(find(r, 'case-mismatch', '/Blog/Post-1/'));
  assert.ok(find(r, 'case-mismatch', '/img/Logo.png'));
  assert.equal(find(r, 'case-mismatch', '/img/Logo.png').severity, 'error');
  for (const u of ['/assets/app.js', '/og.png', '/img/b.png', '/media/intro.mp4', '/embed.html', '/doc.pdf', '/img/hero.jpg']) assert.ok(find(r, 'missing-asset', u), u);
  assert.ok(find(r, 'missing-asset', 'reset.css') && find(r, 'missing-asset', '../img/bg.png'), 'css refs');
  assert.ok(find(r, 'missing-asset', '/icon-192.png'), 'manifest icon');
  assert.ok(find(r, 'missing-fragment', '/about#nope'));
  assert.ok(find(r, 'missing-fragment', '#missing-local'));
  assert.ok(!find(r, 'missing-fragment', '/about#team'));
  assert.ok(!find(r, 'missing-fragment', '#local'));
  assert.equal(find(r, 'form-action').severity, 'warn');
  assert.equal(find(r, 'mixed-content').url, 'http://cdn.example.com/lib.js');
  assert.ok(find(r, 'insecure-link', 'http://example.com/'));
  assert.equal(find(r, 'absolute-internal').fix, 'Use a relative link: /about');
  assert.ok(find(r, 'sitemap-url', 'https://mysite.com/gone/'));
  assert.ok(!find(r, 'sitemap-url', 'https://mysite.com/about'));
  assert.ok(find(r, 'robots-sitemap'));
  assert.ok(find(r, 'relative-in-404'));
  assert.equal(find(r, 'orphan-page').file, 'orphan.html');
  assert.ok(!r.findings.some((f) => /old-blog|\/docs$|commented|not-a-real-link|mailto/.test(f.url)), 'redirects, comments, scripts, mailto ignored');
  assert.ok(!r.findings.some((f) => f.url === '/about' && f.ruleId !== 'absolute-internal'));
  assert.ok(shouldFail(r, 'error'));
  assert.ok(!shouldFail(r, 'none'));
});

test('clean fixture passes (vercel.json cleanUrls + redirects)', async () => {
  const r = await check({ dir: fx('clean') });
  assert.deepEqual(r.findings, []);
  assert.equal(r.options.cleanUrls, true);
  assert.equal(r.options.trailingSlash, 'never');
  assert.equal(shouldFail(r), false);
});

test('trailingSlash and cleanUrls rules', async () => {
  const r = await check({ dir: fx('broken'), trailingSlash: 'always', cleanUrls: true, rules: { 'missing-asset': 'off' } });
  assert.ok(!find(r, 'missing-asset'));
  const r2 = await check({ dir: fx('clean'), trailingSlash: 'always' });
  assert.equal(find(r2, 'trailing-slash', '/docs').fix, 'Use /docs/');
});

test('basePath', async () => {
  const r = await check({ dir: fx('basepath'), basePath: '/docs' });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].ruleId, 'base-path');
  assert.equal(r.findings[0].fix, 'Use /docs/guide/');
});

test('ignore patterns, ignoreFiles and severity overrides', async () => {
  const r = await check({ dir: fx('broken'), ignore: ['/blog/**', 're:\\.pdf$', '/media/*'], ignoreFiles: ['404.html'], rules: { 'missing-fragment': 'error', 'insecure-link': 'off' } });
  assert.ok(!find(r, 'broken-link', '/blog/post-l/'));
  assert.ok(!find(r, 'missing-asset', '/doc.pdf'));
  assert.ok(!find(r, 'missing-asset', '/media/intro.mp4'));
  assert.ok(!find(r, 'relative-in-404'));
  assert.equal(find(r, 'missing-fragment').severity, 'error');
  assert.ok(!find(r, 'insecure-link'));
});

test('formatters', async () => {
  const r = await check({ dir: fx('broken') });
  const p = pretty(r, { color: false });
  assert.match(p, /✖ error Broken internal link \[broken-link\]  line 21/);
  assert.match(p, /fix: did you mean \/blog\/post-1\/\?/);
  assert.match(p, /\d+ error\(s\)/);
  assert.ok(!p.includes('\x1b['));
  assert.ok(pretty(r, { color: true }).includes('\x1b[31m'));
  const md = toMarkdown(r);
  assert.match(md, /^### ❌ static-link-sentinel/);
  assert.match(md, /\| ✖ \| `broken-link` \| `index.html:21` \|/);
  const s = toSarif(r);
  assert.equal(s.version, '2.1.0');
  assert.equal(s.runs[0].results.length, r.findings.length);
  assert.ok(s.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri.startsWith('test/fixtures/broken/'));
});

test('handles a large generated site quickly', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'sls-big-'));
  const N = 3000;
  await writeFile(path.join(dir, 'index.html'), Array.from({ length: N }, (_, i) => `<a href="/p/${i}/">${i}</a>`).join('\n'));
  await Promise.all(Array.from({ length: N }, async (_, i) => {
    await mkdir(path.join(dir, 'p', String(i)), { recursive: true });
    await writeFile(path.join(dir, 'p', String(i), 'index.html'), `<h1 id="t">${i}</h1><a href="/p/${(i + 1) % N}/#t">next</a><a href="/">home</a><img src="/missing-${i % 2 ? 'x' : 'y'}.png">`);
  }));
  const t = Date.now();
  const r = await check({ dir });
  assert.equal(r.stats.pages, N + 1);
  assert.equal(r.counts.error, N);
  assert.ok(Date.now() - t < 15000, `took ${Date.now() - t}ms`);
});
