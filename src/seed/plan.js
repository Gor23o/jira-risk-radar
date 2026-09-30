// Pure helpers for the seed script: turn scenario data into Jira payloads and
// decide what a refresh must do. No network here, so all of it is unit-tested.

import { addBusinessDays } from '../rules/dates.js';

const paragraph = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });

/** Plain text (blank line = new paragraph) plus optional criteria → Atlassian Document Format. */
export function toAdf(text, acceptanceCriteria = []) {
  const content = (text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(paragraph);
  if (acceptanceCriteria.length) {
    content.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Acceptance criteria' }] });
    content.push({
      type: 'bulletList',
      content: acceptanceCriteria.map((item) => ({ type: 'listItem', content: [paragraph(item)] })),
    });
  }
  return { type: 'doc', version: 1, content };
}

/** Due date for a scenario, counted in business days from `anchorDate`. */
export function dueDateFor(scenario, anchorDate, workingDays) {
  return scenario.dueInBusinessDays == null ? null : addBusinessDays(anchorDate, scenario.dueInBusinessDays, workingDays);
}

/**
 * Fields for POST /rest/api/3/issue.
 * @param {object} scenario - one entry from seed-data.js
 * @param {object} ctx
 * @param {string} ctx.projectKey
 * @param {string} ctx.label
 * @param {string|null} ctx.dueDate
 * @param {string|null} ctx.assigneeId - account id, or null for unassigned
 * @param {number|null} ctx.sprintId
 * @param {{sprint: string|null, flagged: string|null}} ctx.customFieldIds
 */
export function createFields(scenario, { projectKey, label, dueDate, assigneeId, sprintId, customFieldIds }) {
  const fields = {
    project: { key: projectKey },
    issuetype: { name: scenario.type },
    summary: scenario.summary,
    priority: { name: scenario.priority },
    labels: [label],
    description: toAdf(scenario.description, scenario.acceptanceCriteria),
    // Explicit null so the project's default assignee doesn't claim it.
    assignee: assigneeId ? { accountId: assigneeId } : null,
  };
  if (dueDate) fields.duedate = dueDate;
  if (sprintId && customFieldIds.sprint) fields[customFieldIds.sprint] = sprintId;
  if (scenario.flagged && customFieldIds.flagged) fields[customFieldIds.flagged] = [{ value: 'Impediment' }];
  return fields;
}

/**
 * Transitions a refresh must make so a healthy issue's time-in-status restarts:
 * out to `viaStatus` and straight back. Nothing for unrefreshed, finished,
 * or already-at-`viaStatus` issues.
 */
export function refreshTransitions(scenario, currentStatus, { viaStatus, doneCategory }) {
  if (!scenario.refresh || doneCategory || currentStatus === viaStatus) return [];
  return [viaStatus, currentStatus];
}

/** The status a scenario ends in once its path is walked. */
export const finalStatus = (scenario) => scenario.path.at(-1) ?? 'To Do';

/**
 * Resolves a scenario's assignee role to an account id.
 * 'teammate' rotates through other users; with none available it falls back to 'me'.
 */
export function resolveAssignee(role, { myId, teammateIds }, index) {
  if (role === null) return null;
  if (role === 'teammate' && teammateIds.length) return teammateIds[index % teammateIds.length];
  return myId;
}
