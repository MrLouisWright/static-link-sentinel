import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { check, checkExternal, classifyExternal } from '../src/index.js';

let server, base, hits = {}, flaky = 0, uas = [];
before(async () => {
  server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    uas.push(req.headers['user-agent']);
    const redirect = (code, to) => { res.writeHead(code, { location: to }); res.end(); };
    switch (req.url) {
      case '/ok': res.writeHead(200, { 'content-type': 'text/html' }); return res.end('ok');
      case '/gone': res.writeHead(404); return res.end();
      case '/removed': res.writeHead(410); return res.end();
      case '/boom': res.writeHead(500); return res.end();
      case '/perm': return redirect(301, '/ok');
      case '/temp': return redirect(302, '/ok');
      case '/chain1': return redirect(301, '/chain2');
      case '/chain2': return redirect(308, `${base}/chain3`);
      case '/chain3': return redirect(302, '/ok');
      case '/to-gone': return redirect(301, '/gone');
      case '/head-405': if (req.method === 'HEAD') { res.writeHead(405); return res.end(); } res.writeHead(200); return res.end('ok');
      case '/flaky': if (++flaky === 1) { res.writeHead(503); return res.end(); } res.writeHead(200); return res.end();
      case '/forbidden': res.writeHead(403); return res.end();
      case '/slow': setTimeout(() => { res.writeHead(200); res.end(); }, 1500); return;
      default: res.writeHead(404); res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const opts = () => ({ cache: false, timeout: 400, retries: 1, hostDelay: 0, perHost: 4 });

test('statuses, HEAD->GET fallback, retries and timeouts', async () => {
  const { results } = await checkExternal(['/ok', '/gone', '/removed', '/boom', '/head-405', '/flaky', '/slow', '/forbidden'].map((p) => base + p), opts());
  const g = (p) => results.get(base + p);
  assert.equal(g('/ok').status, 200);
  assert.equal(g('/gone').status, 404);
  assert.equal(g('/removed').status, 410);
  assert.equal(g('/boom').status, 500);
  assert.equal(g('/head-405').status, 200);
  assert.equal(g('/flaky').status, 200, 'retried after 503');
  assert.equal(g('/slow').timeout, true);
  assert.equal(classifyExternal(g('/gone'))[0].ruleId, 'external-broken');
  assert.equal(classifyExternal(g('/boom'))[0].ruleId, 'external-broken');
  assert.equal(classifyExternal(g('/slow'))[0].ruleId, 'external-timeout');
  assert.equal(classifyExternal(g('/forbidden'))[0].ruleId, 'external-blocked');
  assert.deepEqual(classifyExternal(g('/ok')), []);
});

test('redirect chains show each hop', async () => {
  const { results } = await checkExternal([`${base}/chain1`, `${base}/perm`, `${base}/temp`, `${base}/to-gone`], opts());
  const chain = results.get(`${base}/chain1`);
  assert.deepEqual(chain.hops.map((h) => h.status), [301, 308, 302, 200]);
  assert.equal(chain.finalUrl, `${base}/ok`);
  const f = classifyExternal(chain);
  assert.equal(f[0].ruleId, 'external-redirect-chain');
  assert.match(f[0].message, /301 .*chain1\n→ 308 .*chain2\n→ 302 .*chain3\n→ 200 .*\/ok/);
  assert.equal(f[0].fix, `Update the link to the final URL: ${base}/ok`);
  assert.equal(classifyExternal(results.get(`${base}/perm`))[0].ruleId, 'external-redirect');
  assert.deepEqual(classifyExternal(results.get(`${base}/temp`)), []);
  assert.equal(classifyExternal(results.get(`${base}/to-gone`))[0].ruleId, 'external-broken');
});

test('https -> http downgrade is flagged', () => {
  const f = classifyExternal({ url: 'https://a.test/', hops: [{ url: 'https://a.test/', status: 301 }, { url: 'http://a.test/', status: 200 }], finalUrl: 'http://a.test/', status: 200 });
  assert.equal(f[0].ruleId, 'external-downgrade');
});

test('DNS failure is an error', async () => {
  const { results } = await checkExternal(['http://does-not-exist.invalid/'], { cache: false, retries: 0, timeout: 1500 });
  const r = results.get('http://does-not-exist.invalid/');
  assert.ok(r.error);
  assert.ok(['external-broken', 'external-error', 'external-timeout'].includes(classifyExternal(r)[0].ruleId));
});

test('check --external end to end with cache, skip list and user agent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sls-ext-'));
  await writeFile(path.join(dir, 'index.html'), `<a href="${base}/ok">ok</a>\n<a href="${base}/gone">gone</a>\n<a href="${base}/chain1">chain</a>\n<a href="https://www.linkedin.com/in/x">li</a>\n<a href="${base}/gone#frag">same</a>`);
  const cacheFile = path.join(dir, '.link-cache.json');
  hits = {}; uas = [];
  const o = { dir, external: true, https: false, cacheFile, timeout: 2000, hostDelay: 0, userAgent: 'test-agent/1.0' };
  const r = await check(o);
  assert.equal(r.findings.filter((f) => f.ruleId === 'external-broken').length, 2, 'both occurrences of /gone reported');
  assert.equal(r.findings.find((f) => f.ruleId === 'external-broken').line, 2);
  assert.ok(r.findings.find((f) => f.ruleId === 'external-redirect-chain'));
  assert.ok(!r.findings.some((f) => /linkedin/.test(f.url)), 'linkedin skipped by default');
  assert.equal(r.stats.externalChecked, 3);
  assert.ok(uas.every((u) => u === 'test-agent/1.0'));
  const cache = JSON.parse(await readFile(cacheFile, 'utf8'));
  assert.ok(cache.entries[`${base}/ok`].checkedAt);
  const before = hits['/ok'];
  const r2 = await check(o);
  assert.equal(r2.stats.cached, 3);
  assert.equal(hits['/ok'], before, 'served from cache');
  assert.equal(r2.findings.length, r.findings.length);
  const r3 = await check({ ...o, cacheTtl: 0 });
  assert.equal(r3.stats.cached, 0, 'expired');
});
