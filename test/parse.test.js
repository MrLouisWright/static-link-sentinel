import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml, parseCss, parseSitemap, parseRobots } from '../src/index.js';
import { parseSrcset, decodeEntities } from '../src/parse.js';

test('parseHtml extracts every reference type with line numbers', () => {
  const html = `<html><head>
<link rel="stylesheet" href="/a.css"><link rel="preconnect" href="https://x.com">
<meta property="og:image" content="/og.png"><meta name="twitter:image" content="/tw.png">
<script src="/app.js"></script><script>var s = '<a href="/nope">';</script>
</head><body>
<!-- <a href="/commented"> -->
<a href="/about?x=1&amp;y=2#team">x</a>
<img src="/i.png" srcset="/i.png 1x, /i@2x.png 2x"><picture><source srcset="/s.webp 100w, /s2.webp 200w"></picture>
<video src="/v.mp4" poster="/p.jpg"></video><audio src="/a.mp3"></audio>
<iframe src="/e.html"></iframe><object data="/d.pdf"></object><form action="/api"></form>
<div id="team" style="background:url('/bg.png')"></div><a name="legacy"></a>
</body></html>`;
  const { refs, ids } = parseHtml(html);
  const v = refs.map((r) => r.value);
  for (const x of ['/a.css', '/og.png', '/tw.png', '/app.js', '/about?x=1&y=2#team', '/i.png', '/i@2x.png', '/s.webp', '/s2.webp', '/v.mp4', '/p.jpg', '/a.mp3', '/e.html', '/d.pdf', '/api', '/bg.png']) assert.ok(v.includes(x), x);
  assert.ok(!v.includes('https://x.com'), 'preconnect skipped');
  assert.ok(!v.includes('/nope'), 'inline script ignored');
  assert.ok(!v.includes('/commented'), 'comments ignored');
  assert.equal(refs.find((r) => r.value === '/app.js').line, 4);
  assert.equal(refs.find((r) => r.value === '/api').kind, 'form');
  assert.equal(refs.find((r) => r.value === '/a.css').kind, 'asset');
  assert.ok(ids.has('team') && ids.has('legacy'));
});

test('parseHtml reads <base href> and inline <style>', () => {
  const p = parseHtml('<base href="/sub/"><style>\n.a{background:url(x.png)}</style>');
  assert.equal(p.base, '/sub/');
  assert.equal(p.styles.length, 1);
  assert.equal(parseCss(p.styles[0].css)[0].value, 'x.png');
});

test('parseCss handles url(), @import, comments and data URIs', () => {
  const r = parseCss(`@import "reset.css"; @import url('base.css');\n/* url(no.png) */ a{b:url(data:image/png;base64,AA)} c{d:url( "/f.woff2" )}`).map((x) => x.value);
  assert.deepEqual(r.sort(), ['/f.woff2', 'base.css', 'reset.css']);
});

test('srcset, entities, sitemap and robots', () => {
  assert.deepEqual(parseSrcset('a.png 1x,b.png 2x'), ['a.png', 'b.png']);
  assert.equal(decodeEntities('a&amp;b&#39;&#x41;'), "a&b'A");
  assert.deepEqual(parseSitemap('<urlset>\n<url><loc> https://x.com/a </loc></url></urlset>'), [{ value: 'https://x.com/a', line: 2, col: 6 }]);
  assert.deepEqual(parseRobots('User-agent: *\nSitemap: https://x.com/s.xml'), [{ value: 'https://x.com/s.xml', line: 2, col: 1 }]);
});
