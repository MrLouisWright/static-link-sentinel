import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { check, parseMarkdown } from '../src/index.js';

const fx = (n) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));

test('parseMarkdown skips code and extracts links', () => {
  const md = `# Title

[ok](/a)
\`\`\`
[skip](x)
\`\`\`
\`[inline](y)\`
![img](/i.png)
[ref][id]

[id]: /def
<a href="/html">h</a>
`;
  const { refs, headings } = parseMarkdown(md);
  const v = refs.map((r) => r.value);
  assert.ok(v.includes('/a') && v.includes('/i.png') && v.includes('/def') && v.includes('/html'));
  assert.ok(!v.includes('x') && !v.includes('y'));
  assert.ok(headings.has('title'));
});

test('markdown sources: broken relative links and fragments', async () => {
  const cwd = fx('md-sources');
  const r = await check({ cwd, sources: true });
  assert.equal(r.stats.markdown, 3);
  assert.ok(r.findings.some((f) => f.file === 'docs/broken.md' && f.ruleId === 'broken-link' && /missing\.md/i.test(f.url)));
  assert.ok(r.findings.some((f) => f.ruleId === 'missing-fragment'));
});

test('markdown + build: root-relative checked against dist', async () => {
  const cwd = fx('md-sources');
  const r = await check({ cwd, dir: fx('clean'), sources: ['docs/broken.md'] });
  assert.ok(r.findings.some((f) => f.url === '/nope-page' && f.ruleId === 'broken-link'));
});
