// Builds the email sent after every GitHub Actions run. Pure: no network, no
// clock. Phase 5 adds the risk summary (counts per level, critical issues).

// Deliberately simple: catches typos like a missing "@", not every RFC edge case.
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * Splits "a@x.com, b@y.com" into addresses and reports anything that isn't one.
 * @param {string|undefined} list - comma- or semicolon-separated
 * @returns {{valid: string[], invalid: string[]}}
 */
export function parseRecipients(list) {
  const parts = (list ?? '').split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  const unique = [...new Set(parts)];
  return { valid: unique.filter((a) => EMAIL.test(a)), invalid: unique.filter((a) => !EMAIL.test(a)) };
}

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const COLUMNS = [
  ['Issue', (i) => i.key],
  ['Summary', (i) => i.summary],
  ['Status', (i) => i.status.name],
  ['Assignee', (i) => i.assignee?.name ?? 'Unassigned'],
  ['Due', (i) => i.dueDate ?? '—'],
  ['Sprint', (i) => i.sprint?.name ?? '—'],
  ['Flagged', (i) => (i.flagged ? 'yes' : '')],
];

const CELL = 'padding:6px 10px;border:1px solid #d0d7de;text-align:left;vertical-align:top';

function issuesTableHtml(issues) {
  const head = COLUMNS.map(([title]) => `<th style="${CELL};background:#f6f8fa">${title}</th>`).join('');
  const rows = issues
    .map((issue) => {
      const cells = COLUMNS.map(([title, get]) => {
        const value = escapeHtml(get(issue));
        return title === 'Issue' ? `<a href="${escapeHtml(issue.url)}">${value}</a>` : value;
      });
      return `<tr>${cells.map((c) => `<td style="${CELL}">${c}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<table style="border-collapse:collapse;font-size:14px">${`<tr>${head}</tr>`}${rows}</table>`;
}

function issuesTableText(issues) {
  return issues
    .map((i) => `- ${i.key}  ${i.summary}  [${i.status.name}]  ${i.assignee?.name ?? 'Unassigned'}  due ${i.dueDate ?? '—'}${i.flagged ? '  FLAGGED' : ''}\n  ${i.url}`)
    .join('\n');
}

function page(bodyHtml) {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2328;line-height:1.5">${bodyHtml}</div>`;
}

/**
 * @param {object} options
 * @param {'success'|'failure'} options.status - outcome of the run
 * @param {import('../jira/normalize.js').Issue[]|null} options.issues - null if none were produced
 * @param {string} options.date - reference date, YYYY-MM-DD
 * @param {string} options.jql
 * @param {string} options.runUrl - link to the GitHub Actions run
 * @param {string} [options.failedStep] - human name of the step that failed
 * @returns {{subject: string, text: string, html: string}}
 */
export function buildEmail({ status, issues, date, jql, runUrl, failedStep }) {
  if (status !== 'success' || !issues) {
    const what = failedStep ? `The "${failedStep}" step failed.` : 'The run failed.';
    return {
      subject: `Risk Radar ${date}: run FAILED`,
      text: `${what} No risk results were produced.\n\nOpen the run to see the error:\n${runUrl}\n`,
      html: page(
        `<h2 style="margin:0 0 8px">Risk Radar run failed</h2>` +
          `<p>${escapeHtml(what)} No risk results were produced.</p>` +
          `<p><a href="${escapeHtml(runUrl)}">Open the run to see the error</a></p>`,
      ),
    };
  }

  const count = `${issues.length} issue${issues.length === 1 ? '' : 's'}`;
  const intro = `As of ${date}, the query <code>${escapeHtml(jql)}</code> returned ${count}.`;
  const empty = 'No issues matched the JQL. Check the project key in config.json.';
  const footer =
    `<p style="color:#59636e;font-size:13px">Risk levels arrive with the rule engine and report (phases 3–5). ` +
    `<a href="${escapeHtml(runUrl)}">Open this run on GitHub</a></p>`;

  return {
    subject: `Risk Radar ${date}: ${count}`,
    text:
      `As of ${date}, the query "${jql}" returned ${count}.\n\n` +
      `${issues.length ? issuesTableText(issues) : empty}\n\nRun: ${runUrl}\n`,
    html: page(
      `<h2 style="margin:0 0 8px">Risk Radar: ${count}</h2><p>${intro}</p>` +
        (issues.length ? issuesTableHtml(issues) : `<p>${empty}</p>`) +
        footer,
    ),
  };
}
