import path from 'node:path';
import { check, shouldFail, pretty } from './index.js';

/** Vite plugin: checks the build output after `vite build`. */
export function staticLinkSentinel(options = {}) {
  let config;
  const { fail = true, failOn = 'error', ...opts } = options;
  return {
    name: 'static-link-sentinel',
    apply: 'build',
    enforce: 'post',
    configResolved(c) { config = c; },
    async closeBundle() {
      if (config?.build?.ssr || config?.build?.watch) return;
      const dir = opts.dir ? path.resolve(config?.root || process.cwd(), opts.dir) : path.resolve(config?.root || process.cwd(), config?.build?.outDir || 'dist');
      const base = opts.basePath ?? (config?.base && !/^(\.?\/)?$/.test(config.base) && !/^https?:/.test(config.base) ? config.base : '');
      const report = await check({ ...opts, dir, basePath: base });
      if (report.findings.length || opts.verbose) (config?.logger?.info || console.log)('\n' + pretty(report));
      if (fail && shouldFail(report, failOn)) throw new Error(`static-link-sentinel: ${report.counts.error} error(s), ${report.counts.warn} warning(s) in ${report.dir}/ (fail-on: ${failOn})`);
    },
  };
}
export default staticLinkSentinel;
