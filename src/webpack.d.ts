import type { CheckOptions } from './index.js';
export interface WebpackPluginOptions extends CheckOptions {
  /** Add a compilation error (true, default) or only a warning (false). */
  fail?: boolean;
  failOn?: 'error' | 'warn' | 'none';
  verbose?: boolean;
  /** Also run in watch mode. */
  watch?: boolean;
}
declare class StaticLinkSentinelPlugin {
  constructor(options?: WebpackPluginOptions);
  apply(compiler: any): void;
}
export { StaticLinkSentinelPlugin };
export default StaticLinkSentinelPlugin;
