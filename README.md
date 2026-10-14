# static-link-sentinel

[![npm](https://img.shields.io/npm/v/static-link-sentinel.svg)](https://www.npmjs.com/package/static-link-sentinel)
[![CI](https://github.com/MrLouisWright/static-link-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/MrLouisWright/static-link-sentinel/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![zero deps](https://img.shields.io/badge/dependencies-0-success)

Run it on your **built** static site (`dist/`, `build/`, `out/`, `public/`, `_site/`) before you deploy. It finds broken internal links, missing assets, missing `#anchors` and **paths whose letter case only works on macOS**, then fails CI. With `--external` it also checks outbound links for 404s and redirect chains, showing every hop. You don't need a server: it maps URLs to files the way Netlify, Vercel, GitHub Pages and Cloudflare Pages do (clean URLs, `index.html`, `trailingSlash`, `basePath`, `_redirects`, `vercel.json`). Each problem comes with a fix line, such as *did you mean /blog/post-1/?* Zero dependencies, Node ≥ 18. Output can be JSON, SARIF or Markdown, and it ships with Vite and webpack plugins and a GitHub Action.

## Quick start

```bash
npm run build
npx static-link-sentinel            # auto-detects dist/ build/ out/ public/ _site/
npx static-link-sentinel dist --external --site-url https://example.com
```

```bash
npm i -D static-link-sentinel
# package.json: "postbuild": "static-link-sentinel dist"
```

## Usage

```
static-link-sentinel [dir] [options]      dir defaults to dist/build/out/public/_site

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
  -c, --config <file>         JSON config
      --fail-on <level>       error | warn | none (default error)
      --json                  JSON report on stdout
      --sarif [file]          SARIF 2.1.0 to stdout or file (--sarif=out.sarif)
      --markdown [file]       Markdown summary (PR comments, job summary) to stdout or file
  -q, --quiet                 Hide info-level findings in the pretty output
```

Exit codes: `0` passed, `1` findings at or above `--fail-on`, `2` usage error (bad flag, missing directory, unreadable config). Colours turn off when `NO_COLOR` is set or stdout is not a TTY (`FORCE_COLOR=1` forces them).

### Sample output

```
$ npx static-link-sentinel dist --site-url https://mysite.com --orphans
static-link-sentinel: dist/ 5 page(s), 1 stylesheet(s), 13 file(s), 41 internal reference(s), 2 external link(s) not checked (use --external)

assets/style.css
  ✖ error Missing asset [missing-asset]  line 2
          ../img/bg.png resolves to no file in the build (would serve 404.html)
          fix: Check the build output and asset paths (publicPath/base).

index.html
  ✖ error Mixed content [mixed-content]  line 14
          <script src="http://cdn.example.com/lib.js"> loads over http:// and will be blocked on https
          fix: Use https://cdn.example.com/lib.js
  ✖ error Broken internal link [broken-link]  line 21
          <a href="/blog/post-l/"> resolves to no file in the build (would serve 404.html)
          fix: did you mean /blog/post-1/?
  ✖ error Path case mismatch [case-mismatch]  line 22
          <a href="/Blog/Post-1/"> only matches blog/post-1/index.html with different case (fails on Linux/CDN hosts)
          fix: Use /blog/post-1/ or rename the file
  ⚠ warn  Missing #fragment anchor [missing-fragment]  line 24
          <a href="/about#tem">: no id="tem" in about.html
          fix: did you mean #team?
  ℹ info  Absolute link to own domain [absolute-internal]  line 31
          <a href="https://mysite.com/about"> hard-codes the production domain
          fix: Use a relative link: /about
  ✖ error Path case mismatch [case-mismatch]  line 34
          <img src="/img/Logo.png"> only matches img/logo.png with different case (fails on Linux/CDN hosts)
          fix: Use /img/logo.png or rename the file

sitemap.xml
  ✖ error sitemap.xml URL not in build [sitemap-url]  line 5
          <loc>https://mysite.com/gone/</loc> has no matching page in the build
          fix: Regenerate the sitemap or remove the entry

5 page(s) checked: 17 error(s), 5 warning(s), 2 info
```

With `--external`:

```
index.html
  ⚠ warn  Redirect chain [external-redirect-chain]  line 4
          https://httpbin.org/redirect/3: 3 redirect hops:
          → 302 https://httpbin.org/redirect/3
          → 302 https://httpbin.org/relative-redirect/2
          → 302 https://httpbin.org/relative-redirect/1
          → 200 https://httpbin.org/get
          fix: Update the link to the final URL: https://httpbin.org/get
  ℹ info  Permanent redirect [external-redirect]  line 5
          https://google.com: Permanent redirect (301) to https://www.google.com/
          fix: Update the link to https://www.google.com/
  ✖ error Broken external link [external-broken]  line 6
          https://github.com/MrLouisWright/definitely-not-a-repo-404: HTTP 404
          fix: The page is gone. Remove the link or point it at an archived copy.
```

## What gets checked

| Source | References |
|---|---|
| HTML | `a[href]`, `area[href]`, `link[href]` (stylesheet, icon, apple-touch-icon, preload, modulepreload, manifest, canonical, alternate hreflang), `link[imagesrcset]`, `script[src]`, `img[src\|srcset]`, `source[src\|srcset]`, `video`/`audio` `[src\|poster]`, `track`, `embed`, `iframe[src]`, `object[data]`, `input[type=image]`, `meta` `og:image` / `twitter:image`, `form[action]`, inline `style="url()"` and `<style>`, `#fragment` targets (`id` / `<a name>`), `<base href>` |
| CSS | `url()`, `@import` (every `.css` file in the build) |
| Web manifest | `icons`, `screenshots`, `shortcuts`, `start_url` |
| `sitemap*.xml` | every `<loc>` (urlset and sitemap index) |
| `robots.txt` | `Sitemap:` lines |
| Markdown / MDX (`--sources`) | `[text](url)`, `![alt](url)`, reference links, `<https://…>`, inline HTML `<a href>`; `#heading` anchors vs `#` headings (code blocks skipped) |

`mailto:`, `tel:`, `data:`, `javascript:` and similar schemes are skipped, as are template placeholders (`{{ }}`), HTML comments and the bodies of inline scripts.

### How URLs resolve (no server)

- `/about` → `about.html` or `about/index.html`; `/blog/` → `blog/index.html`.
- `basePath` (`--base-path /docs`): links must start with it. `/guide/` on a `/docs` site is reported as `base-path` with the fix `/docs/guide/`.
- Netlify `_redirects` (splats, `:placeholders`, 200 rewrites, 404 rules) and `vercel.json` `redirects` / `rewrites` (`:slug*`, `(.*)`), from the build dir or its parent. `cleanUrls` and `trailingSlash` are read from `vercel.json` too.
- Where a link doesn't resolve, the message notes whether `404.html` would be served.
- Matching is **case-sensitive**, as on Linux hosts. Where a path only matches with different case, you get `case-mismatch` instead of a silent pass.

## Rules

| Rule | Default | What it catches |
|---|---|---|
| `broken-link` | error | Link (`a`, `area`, canonical/alternate) to a path with no file |
| `missing-asset` | error | Script, stylesheet, image, media, iframe, icon, manifest icon or CSS `url()` missing |
| `case-mismatch` | error | `/img/Logo.png` vs `img/logo.png`: works on macOS, 404s on Linux/CDNs |
| `base-path` | error | Root-relative link escapes the configured `basePath` |
| `mixed-content` | error | `http://` asset on an https site |
| `sitemap-url` | error | `<loc>` with no matching page |
| `robots-sitemap` | error | `robots.txt` points at a sitemap that isn't built |
| `invalid-url` | error | Unparseable URL |
| `missing-fragment` | warn | `#anchor` with no matching `id` / `name` in the target page |
| `form-action` | warn | `<form action>` not in the build (fine if a function handles it) |
| `insecure-link` | warn | Plain `http://` link on an https site |
| `trailing-slash` | warn | Link doesn't match the `trailingSlash` setting (costs a redirect) |
| `relative-in-404` | warn | Relative URL in `404.html`, which is served at arbitrary paths |
| `absolute-internal` | info | Absolute link to your own domain (`--site-url`); relative also works on previews |
| `clean-url` | info | `.html` link while `cleanUrls` is on |
| `orphan-page` | info, opt-in | Page nothing links to (`--orphans`) |
| `external-broken` | error | 404, 410, 5xx or other 4xx, or the host doesn't resolve |
| `external-redirect-chain` | warn | More than one redirect hop (each hop shown) |
| `external-downgrade` | warn | A redirect hop goes from https to http |
| `external-timeout` | warn | No response after retries |
| `external-error` | warn | TLS, connection reset, etc. |
| `external-redirect` | info | Single permanent (301/308) redirect: update the link |
| `external-blocked` | info | 401/403/429/999, usually bot protection |

Set any rule to `error`, `warn`, `info` or `off` in config.

## External links

`--external` sends a `HEAD` request to each unique URL and falls back to `GET` when the server refuses `HEAD`. Redirects are followed by hand so every hop is recorded. Defaults: 8 requests in parallel, 2 per host with `--host-delay` 150 ms between them, a 10 s timeout and 2 retries on timeouts, 5xx and 429 (exponential backoff; `Retry-After` is honoured, capped at 5 s). Results go to `.link-cache.json` and stay valid for 24 h, so a CI rerun only fetches what changed. Timeouts and 5xx responses are not cached. LinkedIn, Twitter/X, Facebook, Instagram and t.co are skipped by default because they block bots. Add more with `--skip` / `externalSkipExtra`, or replace the list with `externalSkip`.

### Markdown before build

```bash
npx static-link-sentinel --sources docs content README.md
npm run build && npx static-link-sentinel dist --sources docs
```

Relative links between `.md` files are checked on disk; root-relative URLs are checked against the build when a directory is passed. Combine with `--external` to validate outbound links in docs.

To keep the cache between CI runs:

```yaml
- uses: actions/cache@v4
  with: { path: .link-cache.json, key: links-${{ github.run_id }}, restore-keys: links- }
```

## Config

The config is read from `--config <file>`, or else the first of `.linkcheckrc.json`, `.static-link-sentinelrc.json`, `static-link-sentinel.config.json`, or `"static-link-sentinel"` in `package.json`. CLI flags win.

```json
{
  "dir": "dist",
  "siteUrl": "https://example.com",
  "basePath": "",
  "trailingSlash": "always",
  "cleanUrls": false,
  "orphans": true,
  "failOn": "error",
  "ignore": ["/admin/**", "re:^/api/", "localhost"],
  "ignoreFiles": ["drafts/**"],
  "rules": { "missing-fragment": "error", "absolute-internal": "off" },
  "redirects": [{ "from": "/old/*", "to": "/new/:splat" }],
  "external": true,
  "externalSkipExtra": ["medium.com", "https://example.org/private/*"],
  "timeout": 8000,
  "concurrency": 8,
  "perHost": 2,
  "retries": 2,
  "userAgent": "Mozilla/5.0 (compatible; my-site-link-check)",
  "cacheFile": ".link-cache.json",
  "cacheTtlHours": 24
}
```

Ignore patterns are globs (`*`, `**`), plain substrings, or `re:<regex>`. They are matched against the raw value, the resolved path and the full URL.

## Framework recipes

### Vite (runs after `vite build`)

```js
// vite.config.js
import { staticLinkSentinel } from 'static-link-sentinel/vite';

export default {
  plugins: [staticLinkSentinel({ failOn: 'error' /* fail: false to only warn */ })],
};
```

The plugin uses `build.outDir`, and `base` as the `basePath`. Any option from the config section works here as well, for example `external: true` or `siteUrl`.

### webpack (afterEmit)

```js
// webpack.config.js (CommonJS works too)
const StaticLinkSentinelPlugin = require('static-link-sentinel/webpack');

module.exports = {
  plugins: [new StaticLinkSentinelPlugin({ failOn: 'error' })],
};
```

It checks `output.path` and treats a string `output.publicPath` as the `basePath`. Problems are added as compilation errors; with `fail: false` they become warnings. ESM: `import StaticLinkSentinelPlugin from 'static-link-sentinel/webpack'`.

### Next.js static export

```js
// next.config.js: output: 'export', basePath: '/docs' (optional), trailingSlash: true (optional)
```

```bash
next build && npx static-link-sentinel out --base-path /docs --trailing-slash always
```

### Astro

```bash
astro build && npx static-link-sentinel dist --site-url https://example.com
```

When `base` is set in `astro.config.mjs`, pass the same value as `--base-path`. Astro is built on Vite, so the Vite plugin also works under `vite.plugins`.

### Eleventy

```bash
npx @11ty/eleventy && npx static-link-sentinel _site
```

When `pathPrefix` is set, pass it as `--base-path`.

### Hugo

```bash
hugo --minify && npx static-link-sentinel public --site-url https://example.com
```

When `baseURL` includes a sub-path (`https://example.com/blog/`), use `--base-path /blog`.

### Netlify / Vercel / GitHub Pages

The `_redirects` file in the publish directory and `vercel.json` in the build directory or project root are read automatically. For GitHub Pages project sites, use `--base-path /<repo>`.

## GitHub Actions

```yaml
name: Links
on: [push, pull_request]
jobs:
  links:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run build
      - uses: MrLouisWright/static-link-sentinel@v1
        with:
          dir: dist
          site-url: https://example.com
          external: ${{ github.event_name == 'push' }}
          fail-on: error
          sarif: links.sarif
      - if: always()
        uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: links.sarif }
```

Inputs: `dir`, `external`, `site-url`, `base-path`, `fail-on`, `config`, `sarif`, `job-summary` (default `true`, which appends the Markdown report to `$GITHUB_STEP_SUMMARY`) and `args` for extra flags. The `markdown-file` output can be posted as a PR comment, for example with `marocchino/sticky-pull-request-comment`.

You can also skip the action:

```yaml
- run: npx static-link-sentinel dist --markdown links.md
- if: always()
  run: cat links.md >> "$GITHUB_STEP_SUMMARY"
```

## API

```js
import { check, shouldFail, pretty, toMarkdown, toSarif } from 'static-link-sentinel';

const report = await check({ dir: 'dist', siteUrl: 'https://example.com', external: true });
console.log(pretty(report));
for (const f of report.findings) console.log(f.severity, f.ruleId, `${f.file}:${f.line}`, f.url, f.fix);
if (shouldFail(report, 'error')) process.exit(1);
```

Also exported: `RULES`, `detectDir`, `checkExternal`, `classifyExternal`, `toJson`, `loadConfig`, `Site` (the URL→file resolver), `parseHtml`, `parseCss`, `parseMarkdown`, `parseSitemap`, `parseRobots`, `parseNetlifyRedirects`, `parseVercelConfig`, `levenshtein`, `listSourceFiles`. TypeScript declarations are generated into `dist/types/` (`npm run build`). CommonJS:

```js
const { check } = require('static-link-sentinel');
const { staticLinkSentinel } = require('static-link-sentinel/vite');
```

Tests live under `test/` and run in [CI](.github/workflows/ci.yml) on Node 18, 20 and 22 (including `require()` smoke tests).

## Limitations

- Only static HTML is checked. Links that client-side JavaScript adds at runtime (SPA routers, `fetch`ed content) are invisible, and SPA fallbacks (`/* /index.html 200`) make every path "exist".
- HTML is read with an offset-preserving regex tokenizer rather than a full HTML5 parser. Badly malformed markup may be misread.
- `_redirects` conditions (country, language, role, query matching) and `vercel.json` `has`/`missing` conditions are ignored. `netlify.toml` `[[redirects]]` blocks are not read; copy them into `_redirects` or the `redirects` config option.
- Redirect rules are matched against paths relative to `basePath`.
- External results depend on the remote server. Some sites return 403/429/999 to bots (reported as info `external-blocked`), and some return 200 on "soft 404" pages.
- Without `--site-url`, sitemap `<loc>` and `robots.txt` URLs are checked by path whatever their host.
- Fragment checks only cover HTML targets and ids in the static markup, not ids added by JS. `#top` is always accepted.

## Releasing

```bash
npm version patch   # or minor / major — bumps package.json, commits and tags
git push --follow-tags
```

Then create a GitHub release from the new tag. `.github/workflows/release.yml` runs the tests on Node 22, then publishes to npmjs (`npm publish --provenance`, which needs the `NPM_TOKEN` secret) and to GitHub Packages as `@mrlouiswright/static-link-sentinel`. Versions that already exist are skipped. To make `uses: MrLouisWright/static-link-sentinel@v1` pick up the new release, move the `v1` tag to it (`git tag -f v1 && git push -f origin v1`).

## Part of a set

- [header-sentinel](https://www.npmjs.com/package/header-sentinel): fail CI on missing or misconfigured HTTP security headers.
- [csp-forge](https://www.npmjs.com/package/csp-forge): generate a Content-Security-Policy.
- [bundle-secret-guard](https://www.npmjs.com/package/bundle-secret-guard): fail the build when secrets ship to the browser.
- [form-honeypot-guard](https://www.npmjs.com/package/form-honeypot-guard): block form spam without a captcha.
- **static-link-sentinel**: fail the build on broken links and missing assets.

## License

MIT © Louis Wright ([Louis Wright](https://github.com/MrLouisWright))