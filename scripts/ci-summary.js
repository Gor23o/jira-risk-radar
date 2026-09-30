// Turns the `--json` report into Markdown for the GitHub Actions run page.
// Usage: node scripts/ci-summary.js out/report.json >> "$GITHUB_STEP_SUMMARY"

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { levelCountsText } from '../src/report/summarize.js';

/** Markdown table cells can't contain pipes or newlines. */
const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const LEVEL = { critical: '🔴 Critical', at_risk: '🟠 At risk', ok: '🟢 OK' };

export function demoAgingNote({ demoAging }) {
  if (!demoAging?.applied || !demoAging.aged.length) return null;
  return `Demo aging: the waiting period was simulated for ${demoAging.aged.length} seeded demo issue(s) (${demoAging.aged.join(', ')}). All other data is live from Jira.`;
}

/** @param {object} report - output of runRadar / `npm run radar -- --json` */
export function renderSummary(report) {
  const { summary, results } = report;
  const lines = [`## Risk Radar ${report.referenceDate}: ${levelCountsText(summary)}`, ''];
  if (summary.total === 0) {
    lines.push('No issues matched the JQL. Check the project key in config.json.');
    return lines.join('\n') + '\n';
  }
  const note = demoAgingNote(report);
  if (note) lines.push(`> ${note}`, '');
  lines.push(`JQL: \`${cell(report.jql)}\` · Claude: ${report.ai}`, '');

  lines.push('### By assignee', '', '| Assignee | Critical | At risk | OK | Total |', '|---|---|---|---|---|');
  for (const p of summary.byAssignee) lines.push(`| ${cell(p.name)} | ${p.critical} | ${p.at_risk} | ${p.ok} | ${p.total} |`);

  const flagged = results.filter((r) => r.level !== 'ok');
  lines.push('', `### Needs attention (${flagged.length})`, '');
  if (flagged.length) {
    lines.push('| Level | Issue | Summary | Status | Assignee | Due | Why |', '|---|---|---|---|---|---|---|');
    for (const { issue, level, flags, escalated } of flagged) {
      const why = flags.map((f) => `**${f.message}**: ${f.evidence}`).join('<br>') + (escalated ? '<br>_Escalated: several distinct problems_' : '');
      lines.push(
        `| ${LEVEL[level]} | [${cell(issue.key)}](${issue.url}) | ${cell(issue.summary)} | ${cell(issue.status.name)} | ` +
          `${cell(issue.assignee?.name ?? 'Unassigned')} | ${cell(issue.dueDate)} | ${cell(why)} |`,
      );
    }
  } else {
    lines.push('Nothing at risk. 🎉');
  }

  const ok = results.filter((r) => r.level === 'ok');
  if (ok.length) {
    lines.push('', `<details><summary>${ok.length} issue(s) OK</summary>`, '');
    for (const { issue } of ok) lines.push(`- [${cell(issue.key)}](${issue.url}) ${cell(issue.summary)} (${cell(issue.status.name)})`);
    lines.push('', '</details>');
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node scripts/ci-summary.js <report.json>');
    process.exit(2);
  }
  process.stdout.write(renderSummary(JSON.parse(readFileSync(path, 'utf8'))));
}
