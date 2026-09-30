// Runs a JQL search and returns raw issues with their complete changelog and
// comments. Search responses can cut both lists short, so we top them up.

const PAGE_SIZE = 100;

const BASE_FIELDS = [
  'summary',
  'issuetype',
  'status',
  'priority',
  'assignee',
  'duedate',
  'created',
  'updated',
  'labels',
  'description',
  'comment',
];

/** Fetches every page of a paginated list endpoint that uses startAt/maxResults. */
async function fetchAllPages(client, path, itemsKey) {
  const items = [];
  for (let startAt = 0; ; ) {
    const page = await client.get(path, { startAt, maxResults: PAGE_SIZE });
    const batch = page[itemsKey] ?? [];
    items.push(...batch);
    startAt += batch.length;
    const done = page.isLast ?? startAt >= (page.total ?? 0);
    if (done || batch.length === 0) return items;
  }
}

/** Replaces a truncated changelog or comment list with the full one. Mutates `issue`. */
async function completeIssue(client, issue) {
  const changelog = issue.changelog;
  if (!changelog || changelog.histories.length < changelog.total) {
    const histories = await fetchAllPages(client, `/rest/api/3/issue/${issue.key}/changelog`, 'values');
    issue.changelog = { histories, total: histories.length, startAt: 0, maxResults: histories.length };
  }

  const comment = issue.fields.comment;
  if (comment && comment.comments.length < comment.total) {
    const comments = await fetchAllPages(client, `/rest/api/3/issue/${issue.key}/comment`, 'comments');
    issue.fields.comment = { comments, total: comments.length, startAt: 0, maxResults: comments.length };
  }
  return issue;
}

/**
 * POST /rest/api/3/search/jql, following nextPageToken until isLast.
 * @param {object} client - from createJiraClient
 * @param {{jql: string, customFieldIds: {sprint: string|null, flagged: string|null}}} options
 * @returns {Promise<object[]>} raw Jira issues, changelog and comments complete
 */
export async function searchIssues(client, { jql, customFieldIds }) {
  const fields = [...BASE_FIELDS, ...Object.values(customFieldIds).filter(Boolean)];
  const issues = [];
  let nextPageToken;

  do {
    const page = await client.post('/rest/api/3/search/jql', {
      jql,
      fields,
      expand: 'changelog',
      maxResults: PAGE_SIZE,
      ...(nextPageToken && { nextPageToken }),
    });
    issues.push(...(page.issues ?? []));
    nextPageToken = page.isLast === false ? page.nextPageToken : undefined;
  } while (nextPageToken);

  // Sequential on purpose: a handful of extra calls at most, and gentle on rate limits.
  for (const issue of issues) await completeIssue(client, issue);
  return issues;
}
