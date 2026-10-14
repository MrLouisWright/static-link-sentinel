import { RULES } from './rules.js';

const useColor = (stream) => !('NO_COLOR' in process.env) && !!(process.env.FORCE_COLOR || stream?.isTTY);

export function pretty(report, { color = useColor(process.stdout), verbose = true } = {}) {
  const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  const red = c(31), yellow = c(33), green = c(32), dim = c(2), bold = c(1), cyan = c(36), blue = c(34);
  const { stats, findings, counts } = report;
  const lines = [];
  const ext = report.options?.external ? `, ${stats.externalChecked} external URL(s) checked${stats.cached ? ` (${stats.cached} cached)` : ''}` : stats.external ? `, ${stats.external} external link(s) not checked (use --external)` : '';
  const where = report.dir != null ? `${report.dir}/` : 'sources';
  const md = stats.markdown ? `, ${stats.markdown} markdown file(s)` : '';
  lines.push(dim(`static-link-sentinel: ${where} ${stats.pages} page(s), ${stats.css} stylesheet(s), ${stats.files} file(s)${md}, ${stats.internal} internal reference(s)${ext}`));
  const groups = new Map();
  for (const f of findings) { if (!groups.has(f.file)) groups.set(f.file, []); groups.get(f.file).push(f); }
  for (const [file, list] of groups) {
    lines.push('', bold(file));
    for (const f of list) {
      if (!verbose && f.severity === 'info') continue;
      const tag = f.severity === 'error' ? red('✖ error') : f.severity === 'warn' ? yellow('⚠ warn ') : blue('ℹ info ');
      lines.push(`  ${tag} ${bold(f.title)} ${dim('[' + f.ruleId + ']')}${f.line ? dim(`  line ${f.line}`) : ''}`);
      lines.push(...String(f.message).split('\n').map((l) => `          ${l}`));
      if (f.fix) lines.push(...f.fix.split('\n').map((l, i) => `          ${i ? '' : cyan('fix: ')}${dim(l)}`));
    }
  }
  if (!findings.length) lines.push('', green('  ✔ no broken links or missing assets'));
  const e = counts.error, w = counts.warn, n = counts.info;
  lines.push('', `${stats.pages} page(s) checked: ${e ? red(e + ' error(s)') : green('0 errors')}, ${w ? yellow(w + ' warning(s)') : '0 warnings'}, ${n} info`);
  return lines.join('\n');
}

const mdEsc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>').replace(/`/g, "'");

export function toMarkdown(report, { max = 300 } = {}) {
  const { stats, findings, counts } = report;
  const icon = counts.error ? '❌' : counts.warn ? '⚠️' : '✅';
  const where = report.dir != null ? `\`${report.dir}/\`` : 'markdown sources';
  const out = [`### ${icon} static-link-sentinel`, '', `**${counts.error} error(s)**, ${counts.warn} warning(s), ${counts.info} info · ${stats.pages} page(s), ${stats.internal} internal reference(s)${report.options?.external ? `, ${stats.externalChecked} external URL(s)` : ''}${stats.markdown ? `, ${stats.markdown} markdown file(s)` : ''} in ${where}`, ''];
  if (!findings.length) { out.push('No broken links or missing assets. 🎉'); return out.join('\n') + '\n'; }
  out.push('| | Rule | Location | Link | Details | Fix |', '|---|---|---|---|---|---|');
  const sym = { error: '✖', warn: '⚠', info: 'ℹ' };
  for (const f of findings.slice(0, max)) out.push(`| ${sym[f.severity]} | \`${f.ruleId}\` | \`${mdEsc(f.file)}${f.line ? ':' + f.line : ''}\` | ${f.url ? '`' + mdEsc(f.url) + '`' : ''} | ${mdEsc(f.message)} | ${mdEsc(f.fix)} |`);
  if (findings.length > max) out.push('', `…and ${findings.length - max} more. Run \`npx static-link-sentinel\` locally for the full list.`);
  return out.join('\n') + '\n';
}

export function toSarif(report, { version = '1.0.0' } = {}) {
  const used = [...new Set(report.findings.map((f) => f.ruleId))];
  const level = { error: 'error', warn: 'warning', info: 'note' };
  const prefix = report.dir == null ? '' : report.dir === '.' ? '' : report.dir.replace(/\\/g, '/') + '/';
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'static-link-sentinel', version, informationUri: 'https://github.com/MrLouisWright/static-link-sentinel', rules: used.map((id) => ({ id, name: id, shortDescription: { text: RULES[id]?.title || id }, fullDescription: { text: RULES[id]?.help || id }, defaultConfiguration: { level: level[RULES[id]?.severity] || 'warning' } })) } },
      results: report.findings.map((f) => ({
        ruleId: f.ruleId, ruleIndex: used.indexOf(f.ruleId), level: level[f.severity],
        message: { text: `${f.message}${f.fix ? `\nFix: ${f.fix}` : ''}` },
        locations: [{ physicalLocation: { artifactLocation: { uri: prefix + f.file }, region: { startLine: f.line || 1, startColumn: f.col || 1 } } }],
      })),
    }],
  };
}

export function toJson(report) {
  const { root, ...rest } = report;
  return rest;
}
