import { promises as fs } from 'node:fs';
import path from 'node:path';
import { walk } from './site.js';
import { toMatcher } from './config.js';
import { parseMarkdown } from './parse.js';

export const DEFAULT_SOURCE_PATTERNS = ['**/*.md', '**/*.mdx', '*.md', '*.mdx'];

/** List markdown/mdx files under cwd matching glob patterns (or exact paths). */
export async function listSourceFiles(cwd, patterns) {
  const pats = patterns === true ? DEFAULT_SOURCE_PATTERNS : patterns;
  if (!pats?.length) return [];
  const matchers = pats.map(toMatcher);
  const all = await walk(cwd);
  const out = [];
  for (const f of all) {
    if (!/\.(md|mdx)$/i.test(f)) continue;
    if (matchers.some((m) => m.test(f))) out.push(f);
  }
  return out.sort();
}

/** GitHub-style heading slug for in-file #fragment checks. */
export function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Resolve a markdown link target to a path relative to cwd, or null if external/special. */
export function resolveMarkdownTarget(raw, mdFile, cwd) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('#')) return { kind: 'fragment' };
  const noHash = trimmed.split('#')[0];
  if (!noHash) return { kind: 'fragment' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(noHash)) return { kind: 'absolute', href: noHash };
  if (noHash.startsWith('//')) return { kind: 'absolute', href: `https:${noHash}` };
  const mdDir = path.dirname(mdFile);
  if (noHash.startsWith('/')) return { kind: 'root', pathname: noHash };
  const rel = path.normalize(path.join(mdDir, noHash));
  return { kind: 'relative', relPath: rel.replace(/\\/g, '/') };
}

/**
 * Scan markdown sources and invoke handle(ref, file, base) like HTML parsing.
 * @param {object} ctx
 */
export async function scanMarkdownSources(ctx) {
  const { cwd, patterns, handle, ignoreFiles, stats, mdHeadings: mdHeadingsOut } = ctx;
  const files = await listSourceFiles(cwd, patterns);
  stats.markdown = files.length;
  const headings = new Map();
  for (const f of files) {
    if (ignoreFiles?.some((m) => m.test(f))) continue;
    const text = await fs.readFile(path.join(cwd, f), 'utf8');
    const parsed = parseMarkdown(text);
    headings.set(f, parsed.headings);
    mdHeadingsOut?.set(f, parsed.headings);
  }
  for (const f of files) {
    if (ignoreFiles?.some((m) => m.test(f))) continue;
    if (!headings.has(f)) continue;
    const text = await fs.readFile(path.join(cwd, f), 'utf8');
    const parsed = parseMarkdown(text);
    const base = new URL(`http://static-link-sentinel.invalid/${f.replace(/\\/g, '/')}`);
    for (const ref of parsed.refs) {
      handle({ ...ref, tag: ref.tag || 'md', attr: ref.attr || 'href' }, f, base, { page: false, markdown: true });
    }
  }
  return { files, headings };
}

export async function fileExists(cwd, rel) {
  try {
    const st = await fs.stat(path.join(cwd, rel));
    return st.isFile();
  } catch {
    return false;
  }
}
