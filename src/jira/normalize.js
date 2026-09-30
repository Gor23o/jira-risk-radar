// Turns a raw Jira issue into the tool's own Issue shape. After this point,
// nothing in the pipeline knows about Jira's JSON layout.

import { adfToText } from '../adf/toText.js';
import { dateInTimezone } from '../rules/dates.js';

/**
 * @typedef {object} Issue
 * @property {string} key
 * @property {string} url
 * @property {string} summary
 * @property {string} type
 * @property {{name: string, category: 'new'|'indeterminate'|'done'}} status
 * @property {string|null} priority
 * @property {{accountId: string, name: string}|null} assignee
 * @property {string|null} dueDate - YYYY-MM-DD
 * @property {string} created - YYYY-MM-DD in config timezone
 * @property {string} createdAt - original timestamp
 * @property {string[]} labels
 * @property {boolean} flagged - Jira "Flagged" (impediment) is set
 * @property {Sprint|null} sprint - the sprint the issue is in now (active, else future)
 * @property {Sprint[]} sprints - every sprint the issue has been in, oldest first
 * @property {string} description - plain text
 * @property {{author: string, createdAt: string, created: string, text: string}[]} comments
 * @property {{at: string, date: string, from: string|null, to: string}[]} statusHistory - oldest first
 *
 * @typedef {object} Sprint
 * @property {number} id
 * @property {string} name
 * @property {'active'|'future'|'closed'} state
 * @property {string|null} startDate - YYYY-MM-DD
 * @property {string|null} endDate - YYYY-MM-DD
 */

const SPRINT_STATE_ORDER = { closed: 0, active: 1, future: 2 };

function toDate(timestamp, timezone) {
  return timestamp ? dateInTimezone(timestamp, timezone) : null;
}

function normalizeSprints(value, timezone) {
  if (!Array.isArray(value)) return [];
  return value
    .map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: toDate(s.startDate, timezone),
      endDate: toDate(s.endDate, timezone),
    }))
    .sort((a, b) => SPRINT_STATE_ORDER[a.state] - SPRINT_STATE_ORDER[b.state] || a.id - b.id);
}

/** The issue's current sprint: the active one, else the next planned one. */
function currentSprint(sprints) {
  return sprints.find((s) => s.state === 'active') ?? sprints.find((s) => s.state === 'future') ?? null;
}

function statusHistory(changelog, timezone) {
  const transitions = [];
  for (const history of changelog?.histories ?? []) {
    for (const item of history.items ?? []) {
      if (item.fieldId === 'status' || item.field === 'status') {
        transitions.push({
          at: history.created,
          date: toDate(history.created, timezone),
          from: item.fromString ?? null,
          to: item.toString,
        });
      }
    }
  }
  return transitions.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * @param {object} raw - one issue from searchIssues
 * @param {{baseUrl: string, timezone: string, customFieldIds: {sprint: string|null, flagged: string|null}}} context
 * @returns {Issue}
 */
export function normalizeIssue(raw, { baseUrl, timezone, customFieldIds }) {
  const f = raw.fields;
  const sprints = customFieldIds.sprint ? normalizeSprints(f[customFieldIds.sprint], timezone) : [];
  const flaggedValue = customFieldIds.flagged ? f[customFieldIds.flagged] : null;

  return {
    key: raw.key,
    url: `${baseUrl}/browse/${raw.key}`,
    summary: f.summary ?? '',
    type: f.issuetype?.name ?? 'Unknown',
    status: { name: f.status.name, category: f.status.statusCategory.key },
    priority: f.priority?.name ?? null,
    assignee: f.assignee ? { accountId: f.assignee.accountId, name: f.assignee.displayName } : null,
    dueDate: f.duedate ?? null,
    created: toDate(f.created, timezone),
    createdAt: f.created,
    labels: f.labels ?? [],
    flagged: Array.isArray(flaggedValue) && flaggedValue.length > 0,
    sprint: currentSprint(sprints),
    sprints,
    description: adfToText(f.description),
    comments: (f.comment?.comments ?? []).map((c) => ({
      author: c.author?.displayName ?? 'Unknown',
      createdAt: c.created,
      created: toDate(c.created, timezone),
      text: adfToText(c.body),
    })),
    statusHistory: statusHistory(raw.changelog, timezone),
  };
}
