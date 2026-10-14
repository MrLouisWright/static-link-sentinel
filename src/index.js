import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { parseHtml, parseCss, parseSitemap, parseRobots, lineIndex, parseMarkdown } from './parse.js';
import { scanMarkdownSources, listSourceFiles, resolveMarkdownTarget, DEFAULT_SOURCE_PATTERNS, slugifyHeading } from './sources.js';
import { walk, Site, parseNetlifyRedirects, parseVercelConfig, normalizeBase, levenshtein, compilePattern } from './site.js';
import { checkExternal, classifyExternal, DEFAULT_SKIP, DEFAULT_USER_AGENT } from './external.js';
import { RULES } from './rules.js';
import { toMatcher, loadConfig } from './config.js';
import { pretty, toMarkdown, toSarif, toJson } from './format.js';

export { RULES, pretty, toMarkdown, toSarif, toJson, loadConfig, Site, walk, parseHtml, parseCss, parseSitemap, parseRobots, parseMarkdown, checkExternal, classifyExternal, levenshtein, compilePattern, parseNetlifyRedirects, parseVercelConfig, listSourceFiles, DEFAULT_SOURCE_PATTERNS, slugifyHeading };

export const BUILD_DIRS = ['dist', 'build', 'out', 'public', '_site'];
const ORIGIN = 'http://static-link-sentinel.invalid';
const SKIP_SCHEME = /^(mailto|tel|sms|javascript|data|blob|about|callto|ftp|file|geo|sip|skype|whatsapp|intent|chrome|webcal|irc|magnet|vbscript):/i;
const TEMPLATE = /\{\{|\{%|\$\{|<%/;

/** Pick the first existing build directory. */
export function detectDir(cwd = process.cwd()) {
  for (const d of BUILD_DIRS) if (existsSync(path.join(cwd, d, 'index.html'))) return d;
  for (const d of BUILD_DIRS) if (existsSync(path.join(cwd, d))) return d;
  return null;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

async function readJson(p) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; } }

/**
 * Check a static build directory and/or markdown sources.
 * @param {import('./index.js').CheckOptions} options
 * @param {boolean|string[]} [options.sources] When true, scan all .md and .mdx files under cwd (default globs). Or pass globs / file paths. Build dir is optional if only sources are checked.
 */
export async function check(options = {}) {
  const o = { ...options };
  const dir = o.dir ?? (o.sources ? null : detectDir(o.cwd));
  if (!dir && !o.sources) throw Object.assign(new Error(`No build directory found (looked for ${BUILD_DIRS.join(', ')}). Pass one explicitly or use --sources.`), { usage: true });
  const srcCwd = path.resolve(o.cwd || process.cwd());
  let root = null;
  let files = [];
  if (dir) {
    root = path.resolve(srcCwd, dir);
    const st = await fs.stat(root).catch(() => null);
    if (!st?.isDirectory()) throw Object.assign(new Error(`Not a directory: ${dir}`), { usage: true });
    files = await walk(root);
  }
  const rules = [];
  if (root) {
    try { rules.push(...parseNetlifyRedirects(await fs.readFile(path.join(root, '_redirects'), 'utf8'))); } catch {}
  }
  let vercel = null;
  if (root) {
    for (const p of [o.vercelConfig, path.join(root, 'vercel.json'), path.join(path.dirname(root), 'vercel.json')].filter(Boolean)) {
      const j = await readJson(p);
      if (j) { vercel = parseVercelConfig(j, path.relative(process.cwd(), p) || 'vercel.json'); break; }
    }
  } else if (o.vercelConfig) {
    const j = await readJson(o.vercelConfig);
    if (j) vercel = parseVercelConfig(j, path.relative(process.cwd(), o.vercelConfig) || 'vercel.json');
  }
  if (vercel) rules.push(...vercel.rules);
  for (const r of o.redirects || []) { const c = compilePattern(r.from || r.source); if (c) rules.push({ ...c, from: r.from || r.source, to: r.to || r.destination, status: r.status || 301, type: 'redirect', file: 'config' }); }

  const cleanUrls = o.cleanUrls ?? vercel?.cleanUrls ?? false;
  let trailingSlash = o.trailingSlash ?? (vercel?.trailingSlash === true ? 'always' : vercel?.trailingSlash === false ? 'never' : 'ignore');
  if (trailingSlash === true) trailingSlash = 'always'; if (trailingSlash === false) trailingSlash = 'never';
  const basePath = normalizeBase(o.basePath);
  const site = new Site(files, { basePath, rules, cleanUrls });
  const siteUrl = o.siteUrl ? new URL(o.siteUrl) : null;
  const https = o.https ?? (siteUrl ? siteUrl.protocol === 'https:' : true);

  const sev = { ...Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, v.severity])), ...(o.rules || {}) };
  if (o.orphans && !(o.rules && o.rules['orphan-page'])) sev['orphan-page'] = 'info';
  else if (!o.orphans) sev['orphan-page'] = 'off';
  const ignore = (o.ignore || []).map(toMatcher);
  const ignoreFiles = (o.ignoreFiles || []).map(toMatcher);
  const skipExt = [...(o.externalSkip ?? DEFAULT_SKIP), ...(o.externalSkipExtra || [])].map((s) => (typeof s === 'string' && !/[*?/]/.test(s) && !s.startsWith('re:') ? { test: (u) => { try { const h = new URL(u).hostname; return h === s || h.endsWith('.' + s); } catch { return false; } } } : toMatcher(s)));

  const findings = [];
  const seen = new Set();
  const add = (f) => {
    const severity = sev[f.ruleId] ?? 'warn';
    if (severity === 'off') return;
    const key = `${f.ruleId}|${f.file}|${f.line}|${f.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ severity, title: RULES[f.ruleId]?.title || f.ruleId, ...f });
  };

  const htmlFiles = files.filter((f) => /\.html?$/i.test(f) && !ignoreFiles.some((m) => m.test(f)));
  const cssFiles = files.filter((f) => /\.css$/i.test(f) && !ignoreFiles.some((m) => m.test(f)));
  const conc = o.readConcurrency || 64;
  const pages = new Map();
  await pool(htmlFiles, conc, async (f) => { pages.set(f, parseHtml(await fs.readFile(path.join(root, f), 'utf8'))); });
  const css = new Map();
  await pool(cssFiles, conc, async (f) => { css.set(f, await fs.readFile(path.join(root, f), 'utf8')); });

  const inbound = new Set();
  const manifests = new Set(files.filter((f) => /\.webmanifest$/i.test(f)));
  const external = new Map();
  const stats = { files: files.length, pages: htmlFiles.length, css: cssFiles.length, markdown: 0, internal: 0, external: 0, externalChecked: 0, cached: 0 };
  const sourceFiles = new Set();
  const mdHeadings = new Map();
  if (o.sources) {
    for (const f of await listSourceFiles(srcCwd, o.sources === true ? true : o.sources)) sourceFiles.add(f);
  }
  const isIgnored = (raw, u) => ignore.some((m) => m.test(raw) || (u && (m.test(u.href.replace(ORIGIN, '')) || m.test(u.pathname) || m.test(u.href))));
  const display = (u) => (u.origin === ORIGIN ? u.pathname + u.search + u.hash : u.href);

  function mdFragmentCheck(targetFile, hash, loc, what) {
    if (!hash || hash.length <= 1 || hash.startsWith('#:~:')) return;
    let id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch {}
    const heads = mdHeadings.get(targetFile);
    if (!heads || heads.has(id) || heads.has(slugifyHeading(id))) return;
    add({ ruleId: 'missing-fragment', ...loc, message: `${what}: no heading for #${id} in ${targetFile}`, fix: 'Fix the anchor or add a matching heading.' });
  }

  function handle(ref, file, base, { page } = {}) {
    const raw = ref.value.trim();
    const loc = { file, line: ref.line, col: ref.col, url: raw, tag: ref.tag };
    const what = ref.tag && ref.attr && ref.tag !== 'md' ? `<${ref.tag} ${ref.attr}="${raw}">` : (ref.tag === 'md' ? `[](${raw})` : raw);
    if (!raw || SKIP_SCHEME.test(raw) || TEMPLATE.test(raw) || raw.startsWith('//#')) return;
    if (raw === '#' || raw.startsWith('#!') || raw.startsWith('#:~:')) return;
    if (isIgnored(raw)) return;
    if (/\.(md|mdx)$/i.test(file)) {
      const hashAt = raw.indexOf('#');
      const pathPart = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
      const hash = hashAt >= 0 ? raw.slice(hashAt) : '';
      if (!pathPart && hash) { mdFragmentCheck(file, hash, loc, what); return; }
      if (pathPart && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(pathPart)) {
        const resolved = resolveMarkdownTarget(pathPart, file, srcCwd);
        if (resolved.kind === 'relative') {
          const candidates = [resolved.relPath];
          if (!/\.(md|mdx|html?)$/i.test(resolved.relPath)) candidates.push(`${resolved.relPath}.md`, `${resolved.relPath}.mdx`);
          const hit = candidates.find((c) => sourceFiles.has(c));
          let built = false;
          if (!hit && dir) {
            const slug = resolved.relPath.replace(/\.(md|mdx)$/i, '').replace(/^\.\//, '');
            built = site.resolve(`/${slug.replace(/\\/g, '/')}`).ok;
          }
          if (!hit && !built) add({ ruleId: 'broken-link', ...loc, message: `${what} points at a missing file`, fix: 'Create the target or fix the path.' });
          if (hash) mdFragmentCheck(hit || resolved.relPath, hash, loc, what);
          return;
        }
      }
    }
    if (file === '404.html' && page && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(raw) && !pages.get(file)?.base)
      add({ ruleId: 'relative-in-404', ...loc, message: `${what} is relative; 404.html is served at any path, so it resolves differently on /a/b/missing`, fix: `Use a root-relative URL: ${display(new URL(raw, base))}` });
    let u;
    try { u = new URL(raw, base); } catch { add({ ruleId: 'invalid-url', ...loc, message: `${what} is not a valid URL` }); return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    if (isIgnored(raw, u)) return;
    let internal = u.origin === ORIGIN;
    if (!internal && siteUrl && u.hostname === siteUrl.hostname) {
      internal = true;
      if (!raw.startsWith('//') && ref.kind !== 'meta-abs' && !(ref.rel && /canonical|alternate/.test(ref.rel)) && ref.tag !== 'meta' && file !== 'sitemap')
        add({ ruleId: 'absolute-internal', ...loc, message: `${what} hard-codes the production domain`, fix: `Use a relative link: ${u.pathname + u.search + u.hash}` });
      if (u.protocol === 'http:' && https) add({ ruleId: ref.kind === 'asset' ? 'mixed-content' : 'insecure-link', ...loc, message: `${what} uses http:// on an https site`, fix: `Use ${'https' + u.href.slice(4)} or a relative URL` });
      const local = new URL(u.pathname + u.search + u.hash, ORIGIN);
      return handleInternal(ref, file, local, loc, what, page);
    }
    if (!internal) {
      stats.external++;
      if (u.protocol === 'http:' && https && !/^(localhost|127\.|\[::1\])/.test(u.hostname))
        add({ ruleId: ref.kind === 'asset' ? 'mixed-content' : 'insecure-link', ...loc, message: ref.kind === 'asset' ? `${what} loads over http:// and will be blocked on https` : `${what} links over plain http://`, fix: `Use ${'https' + u.href.slice(4)}` });
      if (o.external && !skipExt.some((m) => m.test(u.href))) {
        const key = u.href.replace(/#.*$/, '');
        if (!external.has(key)) external.set(key, []);
        external.get(key).push(loc);
      }
      return;
    }
    return handleInternal(ref, file, u, loc, what, page);
  }

  function handleInternal(ref, file, u, loc, what, page) {
    stats.internal++;
    const kind = ref.kind;
    const pathname = u.pathname;
    if (pathname === new URL(page ? site.urlFor(file) : '/', ORIGIN).pathname && page && u.hash && kind === 'link') {
      // same-page fragment
      return checkFragment(u, file, loc, what);
    }
    const r = site.resolve(pathname);
    if (r.outsideBase) {
      const fixed = basePath + pathname;
      const ok = site.resolve(fixed).ok;
      add({ ruleId: 'base-path', ...loc, message: `${what} is outside basePath ${basePath}`, fix: ok ? `Use ${fixed}${u.search}${u.hash}` : `Prefix links with ${basePath}/ (or use relative URLs)` });
      return;
    }
    if (r.caseMismatch) {
      const actual = site.urlFor(r.file);
      add({ ruleId: 'case-mismatch', ...loc, message: `${what} only matches ${r.file} with different case (fails on Linux/CDN hosts)`, fix: `Use ${actual === '/' ? '/' : (pathname.endsWith('/') && !actual.endsWith('/') ? actual + '/' : actual)} or rename the file` });
      return;
    }
    if (!r.ok) {
      const ruleId = kind === 'form' ? 'form-action' : kind === 'link' ? 'broken-link' : 'missing-asset';
      const sug = site.suggest(pathname);
      const fix = sug ? `did you mean ${sug}?` : kind === 'asset' ? 'Check the build output and asset paths (publicPath/base).' : 'Remove the link or create the page.';
      add({ ruleId, ...loc, message: `${what} resolves to no file in the build${site.has404 ? ' (would serve 404.html)' : ''}`, fix });
      return;
    }
    if (r.external) return;
    if (page && r.file !== file) inbound.add(r.file);
    if (ref.rel && /\bmanifest\b/.test(ref.rel)) manifests.add(r.file);
    const isHtml = /\.html?$/i.test(r.file);
    if (kind === 'link' && isHtml && !r.viaRule) {
      if (trailingSlash === 'always' && r.isDir && !pathname.endsWith('/'))
        add({ ruleId: 'trailing-slash', ...loc, message: `${what} lacks the trailing slash (trailingSlash: always)`, fix: `Use ${pathname}/${u.search}${u.hash}` });
      else if (trailingSlash === 'never' && pathname.endsWith('/') && pathname !== (basePath || '') + '/')
        add({ ruleId: 'trailing-slash', ...loc, message: `${what} has a trailing slash (trailingSlash: never)`, fix: `Use ${pathname.replace(/\/+$/, '')}${u.search}${u.hash}` });
      if (cleanUrls && /\.html$/i.test(pathname))
        add({ ruleId: 'clean-url', ...loc, message: `${what} uses .html but cleanUrls is on (costs a redirect)`, fix: `Use ${pathname.replace(/(^|\/)index\.html$/i, '$1').replace(/\.html$/i, '') || '/'}` });
    }
    if (u.hash && u.hash.length > 1 && (kind === 'link' || kind === 'form') && isHtml) checkFragment(u, r.file, loc, what);
  }

  function checkFragment(u, target, loc, what) {
    if (u.hash.startsWith('#:~:') || u.hash.startsWith('#!')) return;
    let id = u.hash.slice(1);
    try { id = decodeURIComponent(id); } catch {}
    const p = pages.get(target);
    if (!p || id === 'top' || p.ids.has(id) || p.ids.has(u.hash.slice(1))) return;
    let best = null, bd = 4;
    for (const c of p.ids) { const d = levenshtein(id.toLowerCase(), c.toLowerCase(), bd); if (d < bd) { bd = d; best = c; } }
    add({ ruleId: 'missing-fragment', ...loc, message: `${what}: no id="${id}" in ${target}`, fix: best ? `did you mean #${best}?` : `Add id="${id}" to the target element or fix the anchor` });
  }

  if (o.sources) {
    await scanMarkdownSources({ cwd: srcCwd, patterns: o.sources === true ? true : o.sources, handle, ignoreFiles, stats, mdHeadings });
  }

  for (const f of htmlFiles) {
    const p = pages.get(f);
    const pageUrl = new URL(site.urlFor(f), ORIGIN);
    let base = pageUrl;
    if (p.base) { try { base = new URL(p.base, pageUrl); } catch {} }
    for (const ref of p.refs) handle(ref, f, base, { page: true });
    for (const s of p.styles) for (const r of parseCss(s.css)) { const lc = p.pos(s.offset + r.offset); handle({ ...r, ...lc, kind: 'asset', tag: 'style', attr: null }, f, base); }
  }
  for (const [f, text] of css) {
    const pos = lineIndex(text);
    const base = new URL(site.urlFor(f), ORIGIN);
    for (const r of parseCss(text)) handle({ ...r, ...pos(r.offset), kind: 'asset' }, f, base);
  }
  for (const f of manifests) {
    const text = await fs.readFile(path.join(root, f), 'utf8').catch(() => null);
    let j; try { j = JSON.parse(text); } catch { continue; }
    const pos = lineIndex(text);
    const base = new URL(site.urlFor(f), ORIGIN);
    const at = (v) => pos(Math.max(0, text.indexOf(JSON.stringify(v))));
    const refs = [];
    for (const key of ['icons', 'screenshots']) for (const i of j[key] || []) if (i?.src) refs.push({ value: i.src, kind: 'asset', ...at(i.src) });
    for (const s of j.shortcuts || []) { if (s?.url) refs.push({ value: s.url, kind: 'link', ...at(s.url) }); for (const i of s.icons || []) if (i?.src) refs.push({ value: i.src, kind: 'asset', ...at(i.src) }); }
    if (j.start_url) refs.push({ value: j.start_url, kind: 'link', ...at(j.start_url) });
    for (const r of refs) handle(r, f, base);
  }
  const sitemapPath = (value) => {
    try { const u = new URL(value); if (siteUrl && u.hostname !== siteUrl.hostname) return null; return u.pathname; } catch { return value.startsWith('/') ? value : null; }
  };
  for (const f of files.filter((x) => /(^|\/)sitemap[^/]*\.xml$/i.test(x))) {
    const xml = await fs.readFile(path.join(root, f), 'utf8');
    for (const l of parseSitemap(xml)) {
      const p = sitemapPath(l.value);
      if (p == null || isIgnored(l.value)) continue;
      const r = site.resolve(p);
      if (!r.ok) add({ ruleId: r.caseMismatch ? 'case-mismatch' : 'sitemap-url', file: f, line: l.line, col: l.col, url: l.value, message: `<loc>${l.value}</loc> ${r.caseMismatch ? `only matches ${r.file} with different case` : r.outsideBase ? `is outside basePath ${basePath}` : 'has no matching page in the build'}`, fix: (() => { const s = !r.caseMismatch && site.suggest(p); return r.caseMismatch ? `Use ${site.urlFor(r.file)}` : s ? `did you mean ${s}?` : 'Regenerate the sitemap or remove the entry'; })() });
    }
  }
  if (files.includes('robots.txt')) {
    for (const l of parseRobots(await fs.readFile(path.join(root, 'robots.txt'), 'utf8'))) {
      const p = sitemapPath(l.value);
      if (p == null) continue;
      const r = site.resolve(p);
      if (!r.ok) add({ ruleId: 'robots-sitemap', file: 'robots.txt', line: l.line, col: 1, url: l.value, message: `Sitemap: ${l.value} is not in the build`, fix: files.find((x) => /sitemap[^/]*\.xml$/i.test(x)) ? `did you mean ${basePath}/${files.find((x) => /sitemap[^/]*\.xml$/i.test(x))}?` : 'Generate a sitemap or remove the line' });
    }
  }
  if (sev['orphan-page'] !== 'off') {
    for (const f of htmlFiles) {
      if (f === 'index.html' || /(^|\/)(404|500|200)\.html$/.test(f) || /^google[0-9a-f]+\.html$/.test(f) || inbound.has(f)) continue;
      add({ ruleId: 'orphan-page', file: f, line: 1, col: 1, url: site.urlFor(f), message: `No page links to ${site.urlFor(f)}`, fix: 'Link it from navigation/sitemap page, or delete it if obsolete' });
    }
  }

  if (o.external && external.size) {
    const { results, cached } = await checkExternal([...external.keys()], {
      concurrency: o.concurrency, perHost: o.perHost, hostDelay: o.hostDelay, timeout: o.timeout, retries: o.retries,
      userAgent: o.userAgent || DEFAULT_USER_AGENT, cache: o.cache !== false,
      cacheFile: o.cacheFile === undefined ? path.resolve(o.cwd || process.cwd(), '.link-cache.json') : o.cacheFile,
      cacheTtl: o.cacheTtl, onProgress: o.onProgress,
    });
    stats.externalChecked = results.size; stats.cached = cached;
    for (const [url, r] of results) for (const f of classifyExternal(r)) for (const loc of external.get(url)) add({ ...loc, ...f, message: `${loc.url}: ${f.message}`, hops: r.hops, finalUrl: r.finalUrl });
  }

  const order = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.line || 0) - (b.line || 0) || order[a.severity] - order[b.severity]));
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  return {
    dir: root ? (path.relative(process.cwd(), root) || '.') : null,
    root,
    stats,
    findings,
    counts,
    options: { basePath, siteUrl: siteUrl?.href, trailingSlash, cleanUrls, external: !!o.external, sources: !!o.sources },
  };
}

/** true when any finding is at or above failOn ('error' | 'warn' | 'none'). */
export function shouldFail(report, failOn = 'error') {
  const findings = Array.isArray(report) ? report : report.findings;
  if (failOn === 'none') return false;
  const lvl = failOn === 'warn' ? ['error', 'warn'] : failOn === 'info' ? ['error', 'warn', 'info'] : ['error'];
  return findings.some((f) => lvl.includes(f.severity));
}

export default check;
