import type { CheckOptions } from './index.js';
export interface VitePluginOptions extends CheckOptions {
  /** Throw (fail the build) when findings reach failOn. Default true. */
  fail?: boolean;
  failOn?: 'error' | 'warn' | 'none';
  /** Print the report even when clean. */
  verbose?: boolean;
}
export function staticLinkSentinel(options?: VitePluginOptions): { name: string; apply: 'build'; enforce: 'post'; configResolved(config: any): void; closeBundle(): Promise<void> };
export default staticLinkSentinel;
