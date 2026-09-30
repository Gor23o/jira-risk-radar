// Jira calls the seed script needs beyond reading issues: checking the project
// can hold the scenarios, moving issues through the workflow, finding seeded issues.

import { discoverCustomFieldIds } from '../jira/fields.js';
import { finalStatus } from './plan.js';

/**
 * Read-only checks before anything is written, so a mismatch (missing status,
 * unknown issue type) fails before the first issue is created, not halfway through.
 * @returns {Promise<object>} everything the seed needs to know about the project
 */
export async function preflight(client, config, scenarios) {
  const key = config.seed.projectKey;
  const [me, users, projectStatuses, createMeta, priorities, customFieldIds] = await Promise.all([
    client.get('/rest/api/3/myself'),
    client.get('/rest/api/3/user/assignable/search', { project: key, maxResults: 100 }),
    client.get(`/rest/api/3/project/${key}/statuses`),
    client.get(`/rest/api/3/issue/createmeta/${key}/issuetypes`),
    client.get('/rest/api/3/priority/search', { maxResults: 100 }),
    discoverCustomFieldIds(client),
  ]);

  const statusCategory = new Map(projectStatuses.flatMap((t) => t.statuses).map((s) => [s.name, s.statusCategory.key]));
  const problems = [];
  const needStatuses = new Set([...scenarios.flatMap((s) => s.path), 'To Do', config.seed.refreshViaStatus]);
  const missingStatuses = [...needStatuses].filter((s) => !statusCategory.has(s));
  if (missingStatuses.length) problems.push(`statuses not in ${key}'s workflow: ${missingStatuses.join(', ')}`);

  const types = new Set(createMeta.issueTypes.map((t) => t.name));
  const missingTypes = [...new Set(scenarios.map((s) => s.type))].filter((t) => !types.has(t));
  if (missingTypes.length) problems.push(`issue types not in ${key}: ${missingTypes.join(', ')}`);

  const priorityNames = new Set(priorities.values.map((p) => p.name));
  const missingPriorities = [...new Set(scenarios.map((s) => s.priority))].filter((p) => !priorityNames.has(p));
  if (missingPriorities.length) problems.push(`priorities not available: ${missingPriorities.join(', ')}`);

  if (problems.length) throw new Error(`Can't seed ${key}:\n  - ${problems.join('\n  - ')}`);

  const warnings = [];
  const teammateIds = users
    .filter((u) => u.accountType === 'atlassian' && u.active && u.accountId !== me.accountId)
    .map((u) => u.accountId);
  if (!teammateIds.length) warnings.push(`No other assignable users in ${key}; "teammate" issues are assigned to you.`);
  if (!customFieldIds.flagged && scenarios.some((s) => s.flagged)) warnings.push('No Flagged field; flagged scenarios will not be flagged.');

  const sprint = await findActiveSprint(client, key);
  if (!sprint) warnings.push(`No active sprint in ${key}; issues go to the backlog.`);

  return { projectKey: key, myId: me.accountId, teammateIds, statusCategory, customFieldIds, sprint, warnings };
}

async function findActiveSprint(client, projectKey) {
  const boards = await client.get('/rest/agile/1.0/board', { projectKeyOrId: projectKey });
  for (const board of boards.values ?? []) {
    const sprints = await client.get(`/rest/agile/1.0/board/${board.id}/sprint`, { state: 'active' });
    if (sprints.values?.length) return { id: sprints.values[0].id, name: sprints.values[0].name };
  }
  return null;
}

/** Moves an issue to `status` using whichever transition leads there. */
export async function transitionTo(client, issueKey, status) {
  const { transitions } = await client.get(`/rest/api/3/issue/${issueKey}/transitions`);
  const match = transitions.find((t) => t.to.name.toLowerCase() === status.toLowerCase());
  if (!match) {
    const available = transitions.map((t) => t.to.name).join(', ');
    throw new Error(`${issueKey}: the workflow has no transition to "${status}" from here (available: ${available}).`);
  }
  await client.post(`/rest/api/3/issue/${issueKey}/transitions`, { transition: { id: match.id } });
}

/** Every issue carrying the seed label in the project, with summary and status. */
export async function findSeedIssues(client, config) {
  const jql = `project = ${config.seed.projectKey} AND labels = "${config.seed.label}" ORDER BY key ASC`;
  const issues = [];
  let nextPageToken;
  do {
    const page = await client.post('/rest/api/3/search/jql', {
      jql,
      fields: ['summary', 'status'],
      maxResults: 100,
      ...(nextPageToken && { nextPageToken }),
    });
    issues.push(...(page.issues ?? []));
    nextPageToken = page.isLast === false ? page.nextPageToken : undefined;
  } while (nextPageToken);
  return issues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status.name,
    category: i.fields.status.statusCategory.key,
  }));
}

/** Short human description of where a scenario ends up, for progress output. */
export function describeScenario(scenario) {
  const bounces = scenario.path.filter((s, i) => s === 'In Progress' && i > 0).length;
  return `${finalStatus(scenario)}${bounces ? ` (${bounces} QA bounce${bounces === 1 ? '' : 's'})` : ''}`;
}
