import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Site, compilePattern, parseNetlifyRedirects, parseVercelConfig, levenshtein } from '../src/index.js';

const files = ['index.html', 'about.html', 'blog/index.html', 'blog/post-1/index.html', 'img/Logo.png', 'docs/guide.html'];

test('clean URLs, index files and trailing slashes resolve', () => {
  const s = new Site(files);
  for (const p of ['/', '/about', '/about.html', '/blog', '/blog/', '/blog/post-1/', '/blog/post-1', '/blog/post-1/index.html', '/docs/guide']) assert.ok(s.resolve(p).ok, p);
  assert.equal(s.resolve('/blog').isDir, true);
  assert.equal(s.resolve('/nope').ok, false);
  assert.equal(s.resolve('/about/').ok, false, 'about.html is not about/index.html');
});

test('case mismatch is detected, not silently accepted', () => {
  const r = new Site(files).resolve('/img/logo.png');
  assert.equal(r.ok, false);
  assert.equal(r.caseMismatch, true);
  assert.equal(r.file, 'img/Logo.png');
});

test('basePath', () => {
  const s = new Site(files, { basePath: '/site/' });
  assert.ok(s.resolve('/site/about').ok);
  assert.ok(s.resolve('/site').ok);
  assert.equal(s.resolve('/about').outsideBase, true);
  assert.equal(s.urlFor('blog/index.html'), '/site/blog/');
});

test('Netlify _redirects and vercel.json rules', () => {
  const rules = parseNetlifyRedirects('# c\n/old/*  /blog/:splat  301\n/p/:id  /blog/:id/ 200\n/ext  https://x.com 302\n/gone /nowhere 404\n');
  assert.equal(rules.length, 4);
  const s = new Site(files, { rules });
  assert.ok(s.resolve('/old/post-1/').ok);
  assert.ok(s.resolve('/p/post-1').ok);
  assert.equal(s.resolve('/ext').external, 'https://x.com');
  assert.equal(s.resolve('/gone').ok, false);
  const v = parseVercelConfig({ cleanUrls: true, trailingSlash: false, redirects: [{ source: '/news/:slug*', destination: '/blog/:slug*', permanent: true }], rewrites: [{ source: '/app/(.*)', destination: '/about' }] });
  assert.equal(v.cleanUrls, true);
  const s2 = new Site(files, { rules: v.rules });
  assert.ok(s2.resolve('/news/post-1').ok);
  assert.ok(s2.resolve('/news').ok);
  assert.ok(s2.resolve('/app/anything/here').ok);
  assert.ok(compilePattern('/a/:b').re.test('/a/x'));
});

test('suggest closest file', () => {
  const s = new Site(files);
  assert.equal(s.suggest('/blog/post-l/'), '/blog/post-1/');
  assert.equal(s.suggest('/abuot'), '/about');
  assert.equal(s.suggest('/completely/different/thing'), null);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});
