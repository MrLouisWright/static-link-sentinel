'use strict';
const path = require('node:path');

/** webpack plugin: checks output.path after emit. */
class StaticLinkSentinelPlugin {
  constructor(options = {}) { this.options = options; }
  apply(compiler) {
    const { fail = true, failOn = 'error', ...opts } = this.options;
    compiler.hooks.afterEmit.tapPromise('StaticLinkSentinelPlugin', async (compilation) => {
      if (compiler.options.watch && !opts.watch) return;
      const { check, shouldFail, pretty } = await import('./index.js');
      const dir = opts.dir ? path.resolve(compiler.context, opts.dir) : compiler.options.output.path;
      let basePath = opts.basePath;
      const pp = compiler.options.output.publicPath;
      if (basePath === undefined && typeof pp === 'string' && pp !== 'auto' && !/^https?:/.test(pp)) basePath = pp;
      const report = await check({ ...opts, dir, basePath });
      if (report.findings.length || opts.verbose) console.log('\n' + pretty(report));
      if (shouldFail(report, failOn)) {
        const err = new Error(`static-link-sentinel: ${report.counts.error} error(s), ${report.counts.warn} warning(s) in ${report.dir}/`);
        (fail ? compilation.errors : compilation.warnings).push(err);
      }
    });
  }
}
module.exports = StaticLinkSentinelPlugin;
module.exports.StaticLinkSentinelPlugin = StaticLinkSentinelPlugin;
module.exports.default = StaticLinkSentinelPlugin;
