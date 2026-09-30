// Turns `--dump` output into a Markdown table for the GitHub Actions run page.
// Temporary: phase 5's HTML report summary replaces this.
// Usage: node scripts/ci-summary.js out/issues.json >> "$GITHUB_STEP_SUMMARY"

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Markdown table cells can't contain pipes or newlines. */
const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** @param {import('../src/jira/normalize.js').Issue[]} issues */
export function renderSummary(issues) {
  const lines = [`## Risk Radar: ${issues.length} issue(s)`, ''];
  if (issues.length === 0) {
    lines.push('No issues matched the JQL. Check the project key in config.json.');
    return lines.join('\n') + '\n';
  }
  lines.push('| Issue | Summary | Status | Assignee | Due | Sprint | Flagged |', '|---|---|---|---|---|---|---|');
  for (const issue of issues) {
    lines.push(
      `| [${cell(issue.key)}](${issue.url}) | ${cell(issue.summary)} | ${cell(issue.status.name)} | ` +
        `${cell(issue.assignee?.name ?? 'Unassigned')} | ${cell(issue.dueDate)} | ${cell(issue.sprint?.name)} | ` +
        `${issue.flagged ? 'yes' : ''} |`,
    );
  }
  lines.push('', '_Risk levels arrive with the rule engine (phase 3) and the report (phase 5)._');
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node scripts/ci-summary.js <issues.json>');
    process.exit(2);
  }
  process.stdout.write(renderSummary(JSON.parse(readFileSync(path, 'utf8'))));
}
