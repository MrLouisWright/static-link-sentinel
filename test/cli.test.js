import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const bin = fileURLToPath(new URL('../bin/static-link-sentinel.js', import.meta.url));
const fx = (n) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
const run = (args, cwd) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '' } });

test('exit codes 0 / 1 / 2', () => {
  assert.equal(run([fx('clean')]).status, 0);
  const bad = run([fx('broken')]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /✖ error/);
  assert.ok(!bad.stdout.includes('\x1b['), 'NO_COLOR respected');
  assert.equal(run([fx('broken'), '--fail-on', 'none']).status, 0);
  assert.equal(run([fx('clean'), '--fail-on', 'warn']).status, 0);
  assert.equal(run(['/does/not/exist']).status, 2);
  assert.equal(run(['--bogus']).status, 2);
  assert.equal(run([fx('clean'), '--fail-on', 'maybe']).status, 2);
  assert.equal(run(['--help']).status, 0);
  assert.match(run(['--version']).stdout, /^\d+\.\d+\.\d+/);
});

test('--json, --sarif file, --markdown file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sls-cli-'));
  const j = JSON.parse(run([fx('broken'), '--json']).stdout);
  assert.ok(j.findings.length > 5);
  assert.equal(j.root, undefined);
  const sarif = path.join(dir, 'out.sarif'), md = path.join(dir, 'summary.md');
  const r = run([fx('broken'), '--sarif', sarif, '--markdown', md]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /page\(s\) checked/);
  assert.equal(JSON.parse(await readFile(sarif, 'utf8')).version, '2.1.0');
  assert.match(await readFile(md, 'utf8'), /\| ✖ \| `broken-link`/);
  assert.match(run([fx('clean'), '--markdown']).stdout, /✅ static-link-sentinel/);
  assert.equal(JSON.parse(run([fx('clean'), '--sarif']).stdout).runs[0].results.length, 0);
});

test('config file and auto-detected build dir', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'sls-cfg-'));
  const { cp } = await import('node:fs/promises');
  await cp(fx('broken'), path.join(cwd, 'dist'), { recursive: true });
  await writeFile(path.join(cwd, '.linkcheckrc.json'), JSON.stringify({ failOn: 'none', rules: { 'missing-asset': 'off' }, ignore: ['/blog/**'] }));
  const r = run(['--json'], cwd);
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.dir, 'dist');
  assert.ok(!j.findings.some((f) => f.ruleId === 'missing-asset' || f.url === '/blog/post-l/'));
  await writeFile(path.join(cwd, 'custom.json'), JSON.stringify({ basePath: '/x' }));
  assert.equal(run(['-c', 'custom.json', '--fail-on', 'error'], cwd).status, 1);
  assert.equal(run(['-c', 'missing.json'], cwd).status, 2);
});
