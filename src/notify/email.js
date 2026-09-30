// Builds the email sent after every GitHub Actions run. Pure: no network, no clock.

import { levelCountsText } from '../report/summarize.js';

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

const CELL = 'padding:6px 10px;border:1px solid #d0d7de;text-align:left;vertical-align:top';
const HEAD = `${CELL};background:#f6f8fa`;
const LEVEL_STYLE = {
  critical: { label: 'Critical', color: '#cf222e' },
  at_risk: { label: 'At risk', color: '#bc4c00' },
  ok: { label: 'OK', color: '#1a7f37' },
};

const page = (body) => `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2328;line-height:1.5">${body}</div>`;
const table = (headers, rows) =>
  `<table style="border-collapse:collapse;font-size:14px;margin:8px 0 16px">` +
  `<tr>${headers.map((h) => `<th style="${HEAD}">${h}</th>`).join('')}</tr>` +
  rows.map((cells) => `<tr>${cells.map((c) => `<td style="${CELL}">${c}</td>`).join('')}</tr>`).join('') +
  `</table>`;

function agingNote({ demoAging }) {
  if (!demoAging?.applied || !demoAging.aged.length) return null;
  return `Demo aging: the waiting period was simulated for ${demoAging.aged.length} seeded demo issue(s) (${demoAging.aged.join(', ')}). All other data is live from Jira.`;
}

function failureEmail({ date, runUrl, failedStep }) {
  const what = failedStep ? `The "${failedStep}" step failed.` : 'The run failed.';
  return {
    subject: `Risk Radar ${date}: run FAILED`,
    text: `${what} No risk results were produced.\n\nOpen the run to see the error:\n${runUrl}\n`,
    html: page(
      `<h2 style="margin:0 0 8px">Risk Radar run failed</h2><p>${escapeHtml(what)} No risk results were produced.</p>` +
        `<p><a href="${escapeHtml(runUrl)}">Open the run to see the error</a></p>`,
    ),
  };
}

/**
 * @param {object} options
 * @param {'success'|'failure'} options.status - outcome of the run
 * @param {object|null} options.report - output of runRadar; null if none was produced
 * @param {string} options.date - reference date, for the subject when there is no report
 * @param {string} options.runUrl - link to the GitHub Actions run
 * @param {string} [options.failedStep] - human name of the step that failed
 * @returns {{subject: string, text: string, html: string}}
 */
export function buildEmail({ status, report, date, runUrl, failedStep }) {
  if (status !== 'success' || !report) return failureEmail({ date, runUrl, failedStep });

  const { summary, results } = report;
  const counts = levelCountsText(summary);
  const subject = `Risk Radar ${report.referenceDate}: ${counts}`;
  const note = agingNote(report);
  const flagged = results.filter((r) => r.level !== 'ok');

  if (summary.total === 0) {
    const empty = 'No issues matched the JQL. Check the project key in config.json.';
    return { subject, text: `${empty}\n\nRun: ${runUrl}\n`, html: page(`<h2>Risk Radar</h2><p>${empty}</p><p><a href="${escapeHtml(runUrl)}">Open this run</a></p>`) };
  }

  // Plain-text part.
  const textLines = [
    `Risk Radar as of ${report.referenceDate}: ${counts}.`,
    ...(note ? ['', note] : []),
    '',
    'By assignee:',
    ...summary.byAssignee.map((p) => `  ${p.name}: ${p.critical} critical, ${p.at_risk} at risk, ${p.ok} ok`),
    '',
    flagged.length ? `Needs attention (${flagged.length}):` : 'Nothing at risk.',
    ...flagged.flatMap(({ issue, level, flags }) => [
      `- [${LEVEL_STYLE[level].label}] ${issue.key} ${issue.summary} (${issue.status.name}, ${issue.assignee?.name ?? 'Unassigned'})`,
      ...flags.map((f) => `    ${f.message}: ${f.evidence}`),
      `    ${issue.url}`,
    ]),
    '',
    `${summary.byLevel.ok} issue(s) OK. Full run: ${runUrl}`,
  ];

  // HTML part.
  const tiles = ['critical', 'at_risk', 'ok']
    .map((level) => {
      const { label, color } = LEVEL_STYLE[level];
      return `<td style="padding:10px 18px;border:1px solid #d0d7de;text-align:center"><div style="font-size:26px;font-weight:600;color:${color}">${summary.byLevel[level]}</div><div style="font-size:13px">${label}</div></td>`;
    })
    .join('');
  const assigneeTable = table(
    ['Assignee', 'Critical', 'At risk', 'OK', 'Total'],
    summary.byAssignee.map((p) => [escapeHtml(p.name), p.critical, p.at_risk, p.ok, p.total]),
  );
  const issueTable = table(
    ['Level', 'Issue', 'Summary', 'Status', 'Assignee', 'Due', 'Why'],
    flagged.map(({ issue, level, flags, escalated }) => [
      `<strong style="color:${LEVEL_STYLE[level].color}">${LEVEL_STYLE[level].label}</strong>`,
      `<a href="${escapeHtml(issue.url)}">${escapeHtml(issue.key)}</a>`,
      escapeHtml(issue.summary),
      escapeHtml(issue.status.name),
      escapeHtml(issue.assignee?.name ?? 'Unassigned'),
      escapeHtml(issue.dueDate ?? '—'),
      flags.map((f) => `<strong>${escapeHtml(f.message)}</strong>: ${escapeHtml(f.evidence)}`).join('<br>') +
        (escalated ? '<br><em>Escalated: several distinct problems</em>' : ''),
    ]),
  );

  const html = page(
    `<h2 style="margin:0 0 8px">Risk Radar: ${escapeHtml(report.referenceDate)}</h2>` +
      `<table style="border-collapse:collapse;margin:8px 0 12px"><tr>${tiles}</tr></table>` +
      (note ? `<p style="background:#fff8c5;border:1px solid #d4a72c;padding:8px 12px;font-size:13px">${escapeHtml(note)}</p>` : '') +
      `<h3 style="margin:16px 0 0">By assignee</h3>${assigneeTable}` +
      `<h3 style="margin:16px 0 0">Needs attention (${flagged.length})</h3>` +
      (flagged.length ? issueTable : '<p>Nothing at risk.</p>') +
      `<p style="color:#59636e;font-size:13px">${summary.byLevel.ok} issue(s) OK. JQL: <code>${escapeHtml(report.jql)}</code> · Claude: ${escapeHtml(report.ai)} · ` +
      `<a href="${escapeHtml(runUrl)}">Open this run on GitHub</a></p>`,
  );

  return { subject, text: textLines.join('\n') + '\n', html };
}
