// "Flagged" and "Sprint" are custom fields whose ids differ between Jira sites
// (customfield_10021 on one, customfield_10007 on another), so we look them up.

const SPRINT_SCHEMA = 'com.pyxis.greenhopper.jira:gh-sprint';
const FLAGGED_SCHEMA = 'com.atlassian.jira.plugin.system.customfieldtypes:multicheckboxes';

/**
 * Finds the custom field ids for Flagged and Sprint in GET /rest/api/3/field output.
 * Pure, so it can be tested with a fixture. A missing field is null, not an error:
 * a Kanban-only site has no Sprint field, and the tool should still work there.
 */
export function findCustomFieldIds(fields) {
  const custom = fields.filter((f) => f.custom);
  const sprint = custom.find((f) => f.schema?.custom === SPRINT_SCHEMA);
  // Prefer the exact built-in type; fall back to the name in case a site differs.
  const flagged =
    custom.find((f) => f.name === 'Flagged' && f.schema?.custom === FLAGGED_SCHEMA) ??
    custom.find((f) => f.name === 'Flagged');
  return { sprint: sprint?.id ?? null, flagged: flagged?.id ?? null };
}

export async function discoverCustomFieldIds(client) {
  return findCustomFieldIds(await client.get('/rest/api/3/field'));
}

/**
 * Returns config status names that don't exist in Jira. A typo like "In Reveiw"
 * would silently disable a rule, so the CLI warns about these.
 */
export function findUnknownStatusNames(config, jiraStatuses) {
  const known = new Set(jiraStatuses.map((s) => s.name.toLowerCase()));
  const configured = new Set([
    ...Object.keys(config.stuckThresholdBusinessDays).filter((name) => name !== 'default'),
    ...config.blockedStatuses,
    ...config.bounce.fromStatuses,
    ...config.bounce.toStatuses,
    ...Object.keys(config.statusCategoryOverrides),
    config.seed.refreshViaStatus,
  ]);
  return [...configured].filter((name) => !known.has(name.toLowerCase()));
}

export async function fetchStatuses(client) {
  return client.get('/rest/api/3/status');
}
