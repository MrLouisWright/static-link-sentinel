#!/usr/bin/env node
import { writeFileSync, readFileSync } from 'node:fs';
import { check, shouldFail, pretty, toMarkdown, toSarif, toJson, loadConfig } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const HELP = `static-link-sentinel ${pkg.version}
Find broken internal links, missing assets and dead external links in a static build before you deploy.

Usage: static-link-sentinel [dir] [options]      dir defaults to dist/build/out/public/_site

  -b, --base-path <path>      Site is served under a sub-path (e.g. /docs)
  -s, --site-url <url>        Production URL: absolute links to it are checked as internal
      --trailing-slash <m>    always | never | ignore (default: ignore, or vercel.json)
      --clean-urls            Host serves /about for about.html (default: vercel.json cleanUrls)
      --orphans               Report pages no other page links to
  -e, --external              Also check external links (HEAD, GET fallback)
      --concurrency <n>       Parallel external requests (default 8)
      --per-host <n>          Parallel requests per host (default 2)
      --host-delay <ms>       Minimum gap between requests to one host (default 150)
      --timeout <ms>          Per-request timeout (default 10000)
      --retries <n>           Retries on timeout/5xx/429 (default 2)
      --user-agent <ua>       User-Agent for external requests
      --skip <pattern>        Don't fetch matching external URLs (repeatable; adds to defaults)
      --cache-file <file>     External result cache (default .link-cache.json)
      --cache-ttl <hours>     Cache lifetime (default 24)
      --no-cache              Don't read or write the cache
      --sources [pattern...]  Also scan markdown/mdx under the project (default **/*.md, **/*.mdx)
  -i, --ignore <pattern>      Ignore matching URLs (glob, substring or re:regex; repeatable)
  -c, --config <file>         JSON config (default .linkcheckrc.json / .static-link-sentinelrc.json /
                              static-link-sentinel.config.json / package.json "static-link-sentinel")
      --fail-on <level>       error | warn | none (default error)
      --json                  JSON report on stdout
      --sarif [file]          SARIF 2.1.0 to stdout or file (--sarif=out.sarif)
      --markdown [file]       Markdown summary (PR comments, job summary) to stdout or file
  -q, --quiet                 Hide info-level findings in the pretty output
  -h, --help                  Show help
  -v, --version               Show version

Exit codes: 0 ok, 1 findings at or above --fail-on, 2 usage error.`;

function parse(argv) {
  const a = { ignore: [], skip: [], sources: null };
  const take = (i, name) => { if (i + 1 >= argv.length) throw usage(`${name} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i], val;
    if (arg.startsWith('--') && arg.includes('=')) { val = arg.slice(arg.indexOf('=') + 1); arg = arg.slice(0, arg.indexOf('=')); }
    const v = (name) => (val !== undefined ? val : argv[++i] ?? (() => { throw usage(`${name} needs a value`); })());
    const opt = (re) => { if (val !== undefined) return val; const n = argv[i + 1]; if (n && !n.startsWith('-') && re.test(n)) { i++; return n; } return true; };
    switch (arg) {
      case '-h': case '--help': a.help = true; break;
      case '-v': case '--version': a.version = true; break;
      case '-b': case '--base-path': a.basePath = v(arg); break;
      case '-s': case '--site-url': a.siteUrl = v(arg); break;
      case '--trailing-slash': a.trailingSlash = v(arg); if (!['always', 'never', 'ignore'].includes(a.trailingSlash)) throw usage('--trailing-slash must be always, never or ignore'); break;
      case '--clean-urls': a.cleanUrls = true; break;
      case '--orphans': a.orphans = true; break;
      case '-e': case '--external': a.external = true; break;
      case '--concurrency': a.concurrency = num(v(arg), arg); break;
      case '--per-host': a.perHost = num(v(arg), arg); break;
      case '--host-delay': a.hostDelay = num(v(arg), arg); break;
      case '--timeout': a.timeout = num(v(arg), arg); break;
      case '--retries': a.retries = num(v(arg), arg); break;
      case '--user-agent': a.userAgent = v(arg); break;
      case '--skip': a.skip.push(v(arg)); break;
      case '--cache-file': a.cacheFile = v(arg); break;
      case '--cache-ttl': a.cacheTtl = num(v(arg), arg) * 3600e3; break;
      case '--no-cache': a.cache = false; break;
      case '--sources': {
        if (a.sources === null) a.sources = [];
        while (i + 1 < argv.length && !argv[i + 1].startsWith('-')) a.sources.push(argv[++i]);
        if (a.sources.length === 0) a.sources = true;
        break;
      }
      case '-i': case '--ignore': a.ignore.push(v(arg)); break;
      case '-c': case '--config': a.config = v(arg); break;
      case '--fail-on': a.failOn = v(arg); if (!['error', 'warn', 'none'].includes(a.failOn)) throw usage('--fail-on must be error, warn or none'); break;
      case '--json': a.json = true; break;
      case '--sarif': a.sarif = opt(/\.(sarif|json)$/i); break;
      case '--markdown': case '--md': a.markdown = opt(/\.(md|markdown|txt)$|STEP_SUMMARY/i); break;
      case '-q': case '--quiet': a.quiet = true; break;
      default:
        if (arg.startsWith('-')) throw usage(`Unknown option ${arg}`);
        if (a.dir) throw usage(`Unexpected argument ${arg}`);
        a.dir = arg;
    }
  }
  return a;
}
function num(s, name) { const n = Number(s); if (!Number.isFinite(n) || n < 0) throw usage(`${name} expects a number`); return n; }
function usage(msg) { return Object.assign(new Error(msg), { usage: true }); }

async function main() {
  let a;
  try { a = parse(process.argv.slice(2)); } catch (e) { console.error(`static-link-sentinel: ${e.message}\nRun with --help for usage.`); return 2; }
  if (a.help) { console.log(HELP); return 0; }
  if (a.version) { console.log(pkg.version); return 0; }
  try {
    const { config } = await loadConfig(a.config);
    const opts = { ...config };
    for (const k of ['dir', 'basePath', 'siteUrl', 'trailingSlash', 'cleanUrls', 'orphans', 'external', 'concurrency', 'perHost', 'hostDelay', 'timeout', 'retries', 'userAgent', 'cacheFile', 'cacheTtl', 'cache', 'sources']) if (a[k] !== undefined && a[k] !== null) opts[k] = a[k];
    if (config.cacheTtlHours && a.cacheTtl === undefined) opts.cacheTtl = config.cacheTtlHours * 3600e3;
    opts.ignore = [...(config.ignore || []), ...a.ignore];
    opts.externalSkipExtra = [...(config.externalSkipExtra || []), ...a.skip];
    const failOn = a.failOn || config.failOn || 'error';
    const interactive = process.stderr.isTTY && a.external && !a.json;
    if (interactive) opts.onProgress = (d, t) => process.stderr.write(`\rchecking external links ${d}/${t}…`);
    const report = await check(opts);
    if (interactive) process.stderr.write('\r\x1b[K');
    if (typeof a.sarif === 'string') writeFileSync(a.sarif, JSON.stringify(toSarif(report, { version: pkg.version }), null, 2));
    if (typeof a.markdown === 'string') writeFileSync(a.markdown, toMarkdown(report));
    if (a.json) console.log(JSON.stringify(toJson(report), null, 2));
    else if (a.sarif === true) console.log(JSON.stringify(toSarif(report, { version: pkg.version }), null, 2));
    else if (a.markdown === true) console.log(toMarkdown(report));
    else console.log(pretty(report, { verbose: !a.quiet }));
    return shouldFail(report, failOn) ? 1 : 0;
  } catch (e) {
    console.error(`static-link-sentinel: ${e.message}`);
    return e.usage ? 2 : 2;
  }
}
main().then((code) => { process.exitCode = code; });
