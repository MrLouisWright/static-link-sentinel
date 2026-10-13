export type Severity = 'error' | 'warn' | 'info';
export type RuleSetting = Severity | 'off';
export type RuleId =
  | 'broken-link' | 'missing-asset' | 'case-mismatch' | 'base-path' | 'missing-fragment' | 'form-action'
  | 'mixed-content' | 'insecure-link' | 'absolute-internal' | 'trailing-slash' | 'clean-url' | 'relative-in-404'
  | 'sitemap-url' | 'robots-sitemap' | 'orphan-page' | 'invalid-url'
  | 'external-broken' | 'external-redirect-chain' | 'external-downgrade' | 'external-redirect'
  | 'external-timeout' | 'external-blocked' | 'external-error';

export interface RedirectRule { from: string; to: string; status?: number }

export interface CheckOptions {
  /** Build directory. Default: first of dist, build, out, public, _site. */
  dir?: string;
  cwd?: string;
  /** Sub-path the site is served under, e.g. "/docs". */
  basePath?: string;
  /** Production URL; absolute links to its host are checked as internal. */
  siteUrl?: string;
  /** Treat the site as https (default: from siteUrl, else true). */
  https?: boolean;
  trailingSlash?: 'always' | 'never' | 'ignore' | boolean;
  cleanUrls?: boolean;
  orphans?: boolean;
  /** Extra redirects on top of _redirects / vercel.json. */
  redirects?: RedirectRule[];
  /** Path to a vercel.json (default: <dir>/vercel.json, then its parent). */
  vercelConfig?: string;
  /** URL patterns to ignore: glob, substring, "re:<regex>" or RegExp. */
  ignore?: Array<string | RegExp>;
  /** Source files (relative to dir) to skip. */
  ignoreFiles?: Array<string | RegExp>;
  /** Per-rule severity overrides. */
  rules?: Partial<Record<RuleId, RuleSetting>>;
  external?: boolean;
  /** Replaces the default skip list (linkedin.com, twitter.com, x.com, facebook.com, instagram.com, t.co). */
  externalSkip?: Array<string | RegExp>;
  /** Added to the skip list. */
  externalSkipExtra?: Array<string | RegExp>;
  concurrency?: number;
  perHost?: number;
  /** Minimum ms between requests to one host (default 150). */
  hostDelay?: number;
  timeout?: number;
  retries?: number;
  userAgent?: string;
  cache?: boolean;
  /** Default ".link-cache.json"; null disables writing. */
  cacheFile?: string | null;
  /** Milliseconds (default 24h). */
  cacheTtl?: number;
  readConcurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface Hop { url: string; status: number }

export interface Finding {
  ruleId: RuleId;
  severity: Severity;
  title: string;
  file: string;
  line?: number;
  col?: number;
  url?: string;
  tag?: string;
  message: string;
  fix?: string;
  hops?: Hop[];
  finalUrl?: string;
}

export interface Report {
  dir: string;
  root: string;
  stats: { files: number; pages: number; css: number; internal: number; external: number; externalChecked: number; cached: number };
  findings: Finding[];
  counts: { error: number; warn: number; info: number };
  options: { basePath: string; siteUrl?: string; trailingSlash: string; cleanUrls: boolean; external: boolean };
}

export interface ExternalResult { url: string; hops: Hop[]; finalUrl: string; status?: number; error?: string; timeout?: boolean; dns?: boolean; cached?: boolean }

export const RULES: Record<RuleId, { severity: Severity; title: string; help: string }>;
export const BUILD_DIRS: string[];
export function check(options?: CheckOptions): Promise<Report>;
export default check;
export function shouldFail(report: Report | Finding[], failOn?: 'error' | 'warn' | 'none'): boolean;
export function detectDir(cwd?: string): string | null;
export function pretty(report: Report, options?: { color?: boolean; verbose?: boolean }): string;
export function toMarkdown(report: Report, options?: { max?: number }): string;
export function toSarif(report: Report, options?: { version?: string }): object;
export function toJson(report: Report): Omit<Report, 'root'>;
export function loadConfig(file?: string, cwd?: string): Promise<{ config: CheckOptions & { failOn?: string }; file: string | null }>;
export function checkExternal(urls: string[], options?: Partial<CheckOptions> & { cacheFile?: string | null; maxRedirects?: number }): Promise<{ results: Map<string, ExternalResult>; cached: number }>;
export function classifyExternal(result: ExternalResult): Array<{ ruleId: RuleId; message: string; fix?: string }>;
export function walk(root: string): Promise<string[]>;
export function levenshtein(a: string, b: string, max?: number): number;
export function parseHtml(html: string): { refs: Array<{ tag: string; attr: string; value: string; kind: 'link' | 'asset' | 'form'; line: number; col: number; rel?: string }>; ids: Set<string>; base: string | null; styles: Array<{ css: string; offset: number }> };
export function parseCss(css: string): Array<{ value: string; offset: number }>;
export function parseSitemap(xml: string): Array<{ value: string; line: number; col: number }>;
export function parseRobots(txt: string): Array<{ value: string; line: number; col: number }>;
export function compilePattern(src: string): { re: RegExp; keys: string[] } | null;
export function parseNetlifyRedirects(text: string, file?: string): object[];
export function parseVercelConfig(json: object, file?: string): { rules: object[]; cleanUrls?: boolean; trailingSlash?: boolean };
export class Site {
  constructor(files: string[], options?: { basePath?: string; rules?: object[]; cleanUrls?: boolean });
  urlFor(file: string): string;
  resolve(pathname: string): { ok: boolean; file?: string; caseMismatch?: boolean; outsideBase?: boolean; isDir?: boolean; external?: string };
  suggest(pathname: string): string | null;
}
