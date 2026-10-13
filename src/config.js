import { promises as fs } from 'node:fs';
import path from 'node:path';

export const CONFIG_FILES = ['.linkcheckrc.json', '.static-link-sentinelrc.json', 'static-link-sentinel.config.json'];

/** Load config: explicit file, else first of CONFIG_FILES in cwd, else package.json "static-link-sentinel". */
export async function loadConfig(file, cwd = process.cwd()) {
  if (file) {
    const p = path.resolve(cwd, file);
    try { return { config: JSON.parse(await fs.readFile(p, 'utf8')), file: p }; }
    catch (e) { throw Object.assign(new Error(`Cannot read config ${file}: ${e.message}`), { usage: true }); }
  }
  for (const f of CONFIG_FILES) {
    const p = path.join(cwd, f);
    try { return { config: JSON.parse(await fs.readFile(p, 'utf8')), file: p }; }
    catch (e) { if (e.code !== 'ENOENT') throw Object.assign(new Error(`Invalid JSON in ${f}: ${e.message}`), { usage: true }); }
  }
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    if (pkg['static-link-sentinel']) return { config: pkg['static-link-sentinel'], file: path.join(cwd, 'package.json') };
  } catch {}
  return { config: {}, file: null };
}

/** Glob ("**", "*") or "re:<regex>" to RegExp. Plain strings without wildcards match as substrings. */
export function toMatcher(p) {
  if (p instanceof RegExp) return p;
  const s = String(p);
  if (s.startsWith('re:')) return new RegExp(s.slice(3));
  if (!/[*?]/.test(s)) return { test: (v) => v.includes(s) };
  const re = s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '.').replace(/\u0000/g, '.*');
  return new RegExp('^' + re + '$');
}
