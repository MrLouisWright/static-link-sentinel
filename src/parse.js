// Lightweight, offset-preserving HTML/CSS/XML reference extraction (no dependencies).
export function lineIndex(text) {
  const offs = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) offs.push(i + 1);
  return (pos) => {
    let lo = 0, hi = offs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (offs[m] <= pos) lo = m; else hi = m - 1; }
    return { line: lo + 1, col: pos - offs[lo] + 1 };
  };
}

const blank = (s) => s.replace(/[^\n]/g, ' ');

export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>';
    if (k === 'quot') return '"'; if (k === 'apos') return "'";
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    try { return String.fromCodePoint(n); } catch { return m; }
  });
}

const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
export function parseAttrs(s = '') {
  const a = {};
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(s))) {
    const k = m[1].toLowerCase();
    if (!(k in a)) a[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return a;
}

export function parseSrcset(v) {
  if (!v || /^\s*data:/i.test(v)) return [];
  return v.split(',').map((s) => s.trim().split(/\s+/)[0]).filter((s) => s && !/^data:/i.test(s));
}

const ASSET_RELS = new Set(['stylesheet', 'icon', 'shortcut', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon', 'preload', 'modulepreload', 'manifest', 'fluid-icon']);
const LINK_RELS = new Set(['canonical', 'alternate', 'next', 'prev', 'author', 'help', 'license', 'prefetch', 'prerender', 'search', 'home']);
const META_IMAGE = new Set(['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src', 'og:video', 'og:audio', 'msapplication-tileimage']);

const TAG = /<([a-zA-Z][\w:-]*)((?:\s*[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;

/** Parse an HTML document. Returns refs (with line/col), ids/names, <base href>, inline CSS blocks. */
export function parseHtml(html) {
  const pos = lineIndex(html);
  let t = html.replace(/<!--[\s\S]*?-->/g, blank);
  t = t.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (m, a, b, c) => a + blank(b) + c);
  const styles = [];
  t = t.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (m, a, b, c, off) => { styles.push({ css: b, offset: off + a.length }); return a + blank(b) + c; });
  const refs = [], ids = new Set();
  let base = null, m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(t))) {
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2]);
    const lower = m[0].toLowerCase();
    const at = (attr) => pos(m.index + Math.max(0, lower.search(new RegExp('\\s' + attr.replace(/[:]/g, '\\$&') + '\\s*='))) + 1);
    const add = (attr, value, kind, extra = {}) => {
      if (value == null) return;
      const p = at(attr);
      refs.push({ tag, attr, value, kind, line: p.line, col: p.col, ...extra });
    };
    if (attrs.id) ids.add(attrs.id);
    if ((tag === 'a' || tag === 'map') && attrs.name) ids.add(attrs.name);
    if (attrs.style && /url\(/i.test(attrs.style)) {
      const p = at('style');
      for (const r of parseCss(attrs.style)) refs.push({ tag, attr: 'style', value: r.value, kind: 'asset', line: p.line, col: p.col });
    }
    switch (tag) {
      case 'base': if (attrs.href && base == null) base = attrs.href; break;
      case 'a': case 'area': if ('href' in attrs) add('href', attrs.href, 'link'); break;
      case 'link': {
        const rels = (attrs.rel || '').toLowerCase().split(/\s+/).filter(Boolean);
        if (rels.some((r) => r === 'preconnect' || r === 'dns-prefetch')) break;
        const kind = rels.some((r) => ASSET_RELS.has(r)) ? 'asset' : rels.some((r) => LINK_RELS.has(r)) ? 'link' : rels.length ? 'link' : 'asset';
        const rel = rels.join(' ');
        if (attrs.href) add('href', attrs.href, kind, { rel, hreflang: attrs.hreflang });
        for (const s of parseSrcset(attrs.imagesrcset)) add('imagesrcset', s, 'asset', { rel });
        break;
      }
      case 'script': if (attrs.src) add('src', attrs.src, 'asset'); break;
      case 'img': case 'source':
        if (attrs.src) add('src', attrs.src, 'asset');
        for (const s of parseSrcset(attrs.srcset)) add('srcset', s, 'asset');
        break;
      case 'video': case 'audio': case 'track': case 'embed':
        if (attrs.src) add('src', attrs.src, 'asset');
        if (attrs.poster) add('poster', attrs.poster, 'asset');
        break;
      case 'input': if ((attrs.type || '').toLowerCase() === 'image' && attrs.src) add('src', attrs.src, 'asset'); break;
      case 'iframe': case 'frame': if (attrs.src) add('src', attrs.src, 'asset'); break;
      case 'object': if (attrs.data) add('data', attrs.data, 'asset'); break;
      case 'meta': {
        const key = (attrs.property || attrs.name || '').toLowerCase();
        if (META_IMAGE.has(key) && attrs.content) add('content', attrs.content, 'asset', { meta: key });
        break;
      }
      case 'form': if (attrs.action) add('action', attrs.action, 'form'); break;
    }
  }
  return { refs, ids, base, styles, pos };
}

/** Extract url() and @import references from CSS. Offsets are relative to the CSS string. */
export function parseCss(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, blank);
  let m;
  const URL_RE = /url\(\s*(["']?)([^"')]*?)\1\s*\)/gi;
  while ((m = URL_RE.exec(clean))) out.push({ value: m[2].trim(), offset: m.index });
  const IMP = /@import\s+(["'])([^"']+)\1/gi;
  while ((m = IMP.exec(clean))) out.push({ value: m[2].trim(), offset: m.index });
  return out.filter((r) => r.value && !/^(data:|#|var\()/i.test(r.value) && !r.value.includes('${'));
}

/** <loc> entries from sitemap / sitemap index XML. */
export function parseSitemap(xml) {
  const out = [];
  const pos = lineIndex(xml);
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) out.push({ value: decodeEntities(m[1]), ...pos(m.index) });
  return out;
}

export function parseRobots(txt) {
  const out = [];
  txt.split(/\r?\n/).forEach((l, i) => { const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(l); if (m) out.push({ value: m[1], line: i + 1, col: 1 }); });
  return out;
}
