// The one entry point the CLI uses to get issues: discover fields, search,
// normalize. Returns clean Issue objects plus any warnings worth showing.

import { createJiraClient, readJiraEnv } from './client.js';
import { discoverCustomFieldIds, fetchStatuses, findUnknownStatusNames } from './fields.js';
import { normalizeIssue } from './normalize.js';
import { searchIssues } from './search.js';

/**
 * @param {object} config - resolved config from loadConfig
 * @param {{client?: object, env?: object}} [deps] - inject a client in tests
 */
export async function fetchIssues(config, { client, env = process.env } = {}) {
  client ??= createJiraClient(readJiraEnv(env));
  const [customFieldIds, statuses] = await Promise.all([discoverCustomFieldIds(client), fetchStatuses(client)]);

  const warnings = [];
  const unknown = findUnknownStatusNames(config, statuses);
  if (unknown.length) {
    warnings.push(`config.json mentions statuses Jira doesn't have: ${unknown.join(', ')}. Rules using them won't fire.`);
  }
  if (!customFieldIds.flagged) warnings.push('No "Flagged" field found; flag-based blocked detection is off.');
  if (!customFieldIds.sprint) warnings.push('No "Sprint" field found; sprint info will be empty.');

  const raw = await searchIssues(client, { jql: config.jql, customFieldIds });
  if (raw.length === 0) {
    // Jira returns an empty result, not an error, for a project key that doesn't exist.
    warnings.push('No issues matched the JQL. Check the project key: it is shown in each issue key (e.g. SCRUM-5).');
  }

  const issues = raw.map((issue) =>
    normalizeIssue(issue, { baseUrl: client.baseUrl, timezone: config.timezone, customFieldIds }),
  );
  return { issues, warnings };
}
