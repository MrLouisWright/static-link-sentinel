import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Recursively list files under root as posix relative paths. */
export async function walk(root) {
  const out = [];
  async function rec(dir, rel) {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(ents.map(async (e) => {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') await rec(path.join(dir, e.name), r); }
      else if (e.isFile()) out.push(r);
      else if (e.isSymbolicLink()) {
        const st = await fs.stat(path.join(dir, e.name)).catch(() => null);
        if (st?.isFile()) out.push(r); else if (st?.isDirectory()) await rec(path.join(dir, e.name), r);
      }
    }));
  }
  await rec(root, '');
  return out.sort();
}

const esc = (c) => c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** Compile a Netlify/Vercel style source pattern (:name, :name*, *, (regex)) to a RegExp. */
export function compilePattern(src) {
  let re = '', i = 0;
  const keys = [];
  while (i < src.length) {
    const ch = src[i];
    if (ch === ':') {
      const m = /^:([A-Za-z_]\w*)([*+?])?/.exec(src.slice(i));
      if (m) {
        keys.push(m[1]);
        if (m[2] === '*' || m[2] === '+') { if (re.endsWith('/') && m[2] === '*') { re = re.slice(0, -1) + '(?:/(.*))?'; } else re += '(.*)'; }
        else if (m[2] === '?') re += '([^/]*)';
        else re += '([^/]+)';
        i += m[0].length; continue;
      }
    }
    if (ch === '*') { keys.push('splat'); re += '(.*)'; i++; continue; }
    if (ch === '(') {
      const end = src.indexOf(')', i);
      if (end > 0) { keys.push(String(keys.filter((k) => /^\d+$/.test(k)).length + 1)); re += '(' + src.slice(i + 1, end) + ')'; i = end + 1; continue; }
    }
    re += esc(ch); i++;
  }
  try { return { re: new RegExp('^' + re + '/?$'), keys }; } catch { return null; }
}

export function parseNetlifyRedirects(text, file = '_redirects') {
  const rules = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const toks = line.split(/\s+/);
    const from = toks.shift();
    while (toks.length && toks[0].includes('=') && !/^(\/|https?:)/.test(toks[0])) toks.shift();
    const to = toks.shift();
    if (!from || !to) return;
    const st = toks[0] && /^\d{3}!?$/.test(toks[0]) ? toks[0] : '301';
    const c = compilePattern(from.replace(/\?.*$/, ''));
    if (c) rules.push({ ...c, from, to, status: parseInt(st, 10), force: st.endsWith('!'), type: parseInt(st, 10) === 200 ? 'rewrite' : 'redirect', file, line: i + 1 });
  });
  return rules;
}

export function parseVercelConfig(json, file = 'vercel.json') {
  const rules = [];
  const add = (r, type) => {
    if (!r?.source || !r?.destination) return;
    if (r.has || r.missing) return; // conditional, can't evaluate statically
    const c = compilePattern(r.source);
    if (c) rules.push({ ...c, from: r.source, to: r.destination, status: type === 'rewrite' ? 200 : r.statusCode || (r.permanent === false ? 307 : 308), type, file });
  };
  for (const r of json.redirects || []) add(r, 'redirect');
  const rw = Array.isArray(json.rewrites) ? json.rewrites : [...(json.rewrites?.beforeFiles || []), ...(json.rewrites?.afterFiles || []), ...(json.rewrites?.fallback || [])];
  for (const r of rw) add(r, 'rewrite');
  return { rules, cleanUrls: json.cleanUrls, trailingSlash: json.trailingSlash };
}

function applyDest(rule, m) {
  const vals = {};
  rule.keys.forEach((k, i) => { vals[k] = m[i + 1] ?? ''; });
  return rule.to
    .replace(/:([A-Za-z_]\w*)\*?/g, (s, k) => (k in vals ? vals[k] : s))
    .replace(/\$(\d+)/g, (s, n) => m[+n] ?? '');
}

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export function levenshtein(a, b, max = Infinity) {
  // Optimal string alignment distance (adjacent transpositions cost 1).
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let pp = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    pp = prev; prev = cur;
  }
  return prev[b.length];
}

/** Maps URL paths to files in a build directory, like a static host would. */
export class Site {
  constructor(files, { basePath = '', rules = [], cleanUrls = false } = {}) {
    this.files = new Set(files);
    this.lower = new Map();
    for (const f of files) if (!this.lower.has(f.toLowerCase())) this.lower.set(f.toLowerCase(), f);
    this.basePath = normalizeBase(basePath);
    this.rules = rules;
    this.cleanUrls = cleanUrls;
    this.has404 = this.files.has('404.html');
  }

  /** URL path (as served, starting with "/") for a file. */
  urlFor(file) {
    let p;
    if (file === 'index.html') p = '/';
    else if (file.endsWith('/index.html')) p = '/' + file.slice(0, -10);
    else if (this.cleanUrls && file.endsWith('.html')) p = '/' + file.slice(0, -5);
    else p = '/' + file;
    return this.basePath + p;
  }

  lookup(rel) {
    const dirLike = rel === '' || rel.endsWith('/');
    const cands = dirLike ? [rel + 'index.html'] : [rel, rel + '.html', rel + '/index.html'];
    for (const c of cands) if (this.files.has(c)) return { file: c, isDir: !dirLike && c === rel + '/index.html' };
    for (const c of cands) {
      const hit = this.lower.get(c.toLowerCase());
      if (hit) return { file: hit, caseMismatch: true, requested: c };
    }
    return null;
  }

  /** Resolve a URL pathname. */
  resolve(pathname) {
    let p = safeDecode(pathname);
    if (this.basePath) {
      if (p === this.basePath || p.startsWith(this.basePath + '/')) p = p.slice(this.basePath.length) || '/';
      else return { ok: false, outsideBase: true };
    }
    return this.resolveRel(p, 0);
  }

  resolveRel(p, depth) {
    const hit = this.lookup(p.replace(/^\/+/, ''));
    if (hit && !hit.caseMismatch) return { ok: true, ...hit };
    if (depth < 6) {
      for (const rule of this.rules) {
        const m = rule.re.exec(p);
        if (!m) continue;
        const dest = applyDest(rule, m);
        if (rule.status === 404) break;
        if (/^[a-z][a-z0-9+.-]*:/i.test(dest)) return { ok: true, viaRule: rule, external: dest };
        const dp = dest.replace(/[?#].*$/, '');
        if (dp === p) continue;
        const r = this.resolveRel(dp, depth + 1);
        if (r.ok) return { ...r, viaRule: rule };
      }
    }
    if (hit) return { ok: false, ...hit };
    return { ok: false };
  }

  /** Closest existing URL to a missing path (Levenshtein). */
  suggest(pathname) {
    this._memo ??= new Map();
    if (!this._memo.has(pathname)) this._memo.set(pathname, this._suggest(pathname));
    return this._memo.get(pathname);
  }

  _suggest(pathname) {
    if (!this._cands) {
      const c = new Set();
      for (const f of this.files) {
        c.add('/' + f);
        if (f === 'index.html') c.add('/');
        else if (f.endsWith('/index.html')) { c.add('/' + f.slice(0, -10)); c.add('/' + f.slice(0, -11)); }
        else if (f.endsWith('.html')) c.add('/' + f.slice(0, -5));
      }
      this._cands = [...c];
    }
    let p = safeDecode(pathname);
    if (this.basePath && p.startsWith(this.basePath + '/')) p = p.slice(this.basePath.length);
    const max = Math.max(2, Math.floor(p.length * 0.34));
    let best = null, bestD = max + 1;
    const trail = p.endsWith('/');
    for (const c of this._cands) {
      const d = levenshtein(p.toLowerCase(), c.toLowerCase(), Math.min(max, bestD));
      if (d < bestD || (d === bestD && best && c.endsWith('/') === trail && best.endsWith('/') !== trail)) { bestD = d; best = c; }
    }
    if (!best || bestD > max) return null;
    const bn = (x) => x.replace(/\/+$/, '').split('/').pop().toLowerCase();
    const a = bn(p), b = bn(best);
    if (a !== b && levenshtein(a, b) > Math.max(1, Math.floor(a.length * 0.3))) return null;
    return this.basePath + best;
  }
}

export function normalizeBase(b) {
  if (!b || b === '/' || b === './' || b === '.') return '';
  let s = String(b).trim();
  try { if (/^https?:/i.test(s)) s = new URL(s).pathname; } catch {}
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\/+$/, '');
}
