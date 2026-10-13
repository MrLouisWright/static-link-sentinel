# Changelog

## 1.0.1 (2026-10-13)

- CI: harden workflows (actions pinned to SHAs, least-privilege permissions, persist-credentials: false)

## 1.0.0 (2026-10-13)

First release.

- CLI `static-link-sentinel [dir]` that crawls a static build (auto-detects `dist/`, `build/`, `out/`, `public/`, `_site/`) without a server.
- Resolves URLs the way static hosts do: clean URLs, `index.html`, `trailingSlash`, `basePath`, `cleanUrls`, `404.html`, Netlify `_redirects`, `vercel.json` redirects and rewrites.
- Checks `a`, `area`, `link` (stylesheet, icon, preload, manifest, canonical, alternate hreflang), `script`, `img`/`source` `src` and `srcset`, `video`/`audio` `src`/`poster`, `iframe`, `object`, `og:image`/`twitter:image`, `form action`, CSS `url()` and `@import`, web manifest icons, `sitemap.xml` and `robots.txt` sitemap lines.
- Rules: `broken-link`, `missing-asset`, `case-mismatch`, `base-path`, `missing-fragment`, `form-action`, `mixed-content`, `insecure-link`, `absolute-internal`, `trailing-slash`, `clean-url`, `relative-in-404`, `sitemap-url`, `robots-sitemap`, `orphan-page`, `invalid-url`, and the `external-*` rules.
- `--external`: HEAD with GET fallback, concurrency and per-host limits, retries, timeouts, every redirect hop shown, `.link-cache.json` with a TTL.
- Fix suggestions, including the closest existing path ("did you mean /blog/post-1/?") and the closest `#id`.
- Output as coloured text, `--json`, `--sarif`, `--markdown`; `--fail-on`; config files with ignore patterns and per-rule severity.
- Programmatic API, Vite plugin, webpack plugin (ESM and CJS) and a composite GitHub Action that writes the job summary.
