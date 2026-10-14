import esbuild from 'esbuild';
import { execSync } from 'node:child_process';

await esbuild.build({
  entryPoints: { index: 'src/index.js', vite: 'src/vite.js' },
  outdir: 'dist',
  entryNames: '[name]',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  bundle: true,
  outExtension: { '.js': '.cjs' },
});

execSync('tsc -p tsconfig.json', { stdio: 'inherit' });
