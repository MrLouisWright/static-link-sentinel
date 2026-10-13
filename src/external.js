import { promises as fs } from 'node:fs';

export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; static-link-sentinel/1.0; +https://github.com/MrLouisWright/static-link-sentinel)';
export const DEFAULT_SKIP = ['linkedin.com', 'www.linkedin.com', 'twitter.com', 'x.com', 'facebook.com', 'www.facebook.com', 'instagram.com', 'www.instagram.com', 't.co'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDefinitive = (r) => !r.timeout && !(r.status >= 500) && r.status !== 429 && !(r.error && !r.dns);

async function loadCache(file, ttlMs) {
  if (!file) return {};
  try {
    const j = JSON.parse(await fs.readFile(file, 'utf8'));
    const now = Date.now(), out = {};
    for (const [k, v] of Object.entries(j.entries || {})) if (v && now - v.checkedAt < ttlMs) out[k] = v;
    return out;
  } catch { return {}; }
}

/**
 * Check external URLs. Follows redirects manually so every hop is recorded.
 * @returns {Promise<{results: Map<string, object>, cached: number}>}
 */
export async function checkExternal(urls, o = {}) {
  const {
    concurrency = 8, perHost = 2, hostDelay = 150, timeout = 10000, retries = 2,
    userAgent = DEFAULT_USER_AGENT, maxRedirects = 10, cacheFile = '.link-cache.json',
    cacheTtl = 24 * 3600e3, cache = true, onProgress,
  } = o;
  const store = cache ? await loadCache(cacheFile, cacheTtl) : {};
  const results = new Map();
  let cached = 0;
  const hosts = new Map();

  async function hostSlot(host, fn) {
    let h = hosts.get(host);
    if (!h) hosts.set(host, (h = { active: 0, last: 0, waiters: [] }));
    while (h.active >= perHost) await new Promise((r) => h.waiters.push(r));
    h.active++;
    try {
      const wait = h.last + hostDelay - Date.now();
      if (wait > 0) await sleep(wait);
      h.last = Date.now();
      return await fn();
    } finally { h.active--; h.waiters.shift()?.(); }
  }

  async function once(url, method) {
    const res = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
    try { await res.body?.cancel(); } catch {}
    return { status: res.status, location: res.headers.get('location'), retryAfter: res.headers.get('retry-after') };
  }

  async function request(url) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        let r = await hostSlot(new URL(url).host, () => once(url, 'HEAD'));
        if (r.status >= 400 || r.status === 0) r = await hostSlot(new URL(url).host, () => once(url, 'GET'));
        last = r;
        if ((r.status >= 500 || r.status === 429) && attempt < retries) {
          const ra = Math.min(5000, (parseInt(r.retryAfter, 10) || 0) * 1000);
          await sleep(ra || 400 * 2 ** attempt); continue;
        }
        return r;
      } catch (e) {
        const code = e?.cause?.code || e?.code || '';
        const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError' || /TIMEOUT/i.test(code);
        last = { error: isTimeout ? `timed out after ${timeout}ms` : (code ? `${code} ${e.cause?.message || e.message}` : e.message), timeout: isTimeout, dns: /ENOTFOUND|EAI_AGAIN/.test(code) };
        if (last.dns) return last;
        if (attempt < retries) await sleep(400 * 2 ** attempt);
      }
    }
    return last;
  }

  async function checkOne(url) {
    const hops = [];
    let current = url;
    for (let i = 0; i <= maxRedirects; i++) {
      const r = await request(current);
      if (r.error) return { url, hops, finalUrl: current, error: r.error, timeout: r.timeout, dns: r.dns };
      hops.push({ url: current, status: r.status });
      if (r.status >= 300 && r.status < 400 && r.location) { current = new URL(r.location, current).href; continue; }
      return { url, hops, finalUrl: current, status: r.status };
    }
    return { url, hops, finalUrl: current, error: `more than ${maxRedirects} redirects` };
  }

  const queue = [...new Set(urls)];
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const url = queue.shift();
      let r = store[url]?.result;
      if (r) { cached++; r = { ...r, cached: true }; }
      else { r = await checkOne(url); if (isDefinitive(r)) store[url] = { checkedAt: Date.now(), result: r }; }
      results.set(url, r);
      onProgress?.(++done, done + queue.length);
    }
  }));
  if (cache && cacheFile) {
    const entries = {};
    for (const [k, v] of Object.entries(store)) entries[k] = v;
    await fs.writeFile(cacheFile, JSON.stringify({ version: 1, entries }, null, 1)).catch(() => {});
  }
  return { results, cached };
}

/** Turn an external check result into findings (without location). */
export function classifyExternal(r) {
  const out = [];
  const hopText = () => r.hops.map((h) => `${h.status} ${h.url}`).join('\n→ ');
  if (r.error) {
    if (r.timeout) out.push({ ruleId: 'external-timeout', message: `Request ${r.error}`, fix: 'Check the link manually, raise --timeout, or add the host to "externalSkip".' });
    else if (r.dns) out.push({ ruleId: 'external-broken', message: `Host does not resolve (${r.error})`, fix: 'The domain is gone or misspelt; remove or replace the link.' });
    else out.push({ ruleId: 'external-error', message: `Request failed: ${r.error}`, fix: 'Check the link manually or add it to "ignore".' });
  } else if (r.status === 401 || r.status === 403 || r.status === 429 || r.status === 999) {
    out.push({ ruleId: 'external-blocked', message: `HTTP ${r.status}: the server refused the automated check`, fix: 'Probably bot protection. Add the host to "externalSkip" if it is fine in a browser.' });
  } else if (r.status >= 400) {
    out.push({ ruleId: 'external-broken', message: `HTTP ${r.status}${r.hops.length > 1 ? ` after ${r.hops.length - 1} redirect(s)` : ''}`, fix: r.status === 404 || r.status === 410 ? 'The page is gone. Remove the link or point it at an archived copy.' : 'Server error. Retry later or contact the site owner.' });
  }
  const redirects = r.hops.filter((h) => h.status >= 300 && h.status < 400);
  if (redirects.length) {
    const downgrade = r.hops.some((h, i) => i > 0 && h.url.startsWith('http:') && r.hops[i - 1].url.startsWith('https:'));
    const finalOk = !r.error && r.status < 400;
    if (downgrade) out.push({ ruleId: 'external-downgrade', message: `Redirect chain downgrades from https to http:\n→ ${hopText()}`, fix: finalOk ? `Update the link to ${r.finalUrl}` : undefined });
    if (redirects.length > 1) out.push({ ruleId: 'external-redirect-chain', message: `${redirects.length} redirect hops:\n→ ${hopText()}`, fix: finalOk ? `Update the link to the final URL: ${r.finalUrl}` : undefined });
    else if (!downgrade && (redirects[0].status === 301 || redirects[0].status === 308) && finalOk) out.push({ ruleId: 'external-redirect', message: `Permanent redirect (${redirects[0].status}) to ${r.finalUrl}`, fix: `Update the link to ${r.finalUrl}` });
  }
  return out;
}
