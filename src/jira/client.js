// Thin HTTP client for Jira Cloud REST v3. Handles auth, retries on rate
// limits, and turns HTTP failures into errors that say what to fix.

const REQUIRED_ENV = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
const RETRYABLE = new Set([429, 503]);
const MAX_RETRIES = 3;

export class JiraError extends Error {
  constructor(message, { status, path } = {}) {
    super(message);
    this.name = 'JiraError';
    this.status = status;
    this.path = path;
  }
}

/** Reads Jira settings from the environment, failing with the list of missing variables. */
export function readJiraEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length) {
    const fix =
      env.GITHUB_ACTIONS === 'true'
        ? 'Add them as secrets of the GitHub environment the workflow uses (see README → Scheduled runs).'
        : 'Copy .env.example to .env and fill in your Jira details.';
    throw new JiraError(`Missing ${missing.join(', ')}. ${fix}`);
  }
  return {
    baseUrl: env.JIRA_BASE_URL.trim().replace(/\/+$/, ''),
    email: env.JIRA_EMAIL.trim(),
    apiToken: env.JIRA_API_TOKEN.trim(),
  };
}

/** Seconds to wait before retrying, from the Retry-After header (seconds or HTTP date). */
function retryDelayMs(response, attempt) {
  const header = response.headers.get('retry-after');
  const seconds = Number(header);
  if (header && Number.isFinite(seconds)) return seconds * 1000;
  const date = header && Date.parse(header);
  if (date) return Math.max(0, date - Date.now());
  return 2 ** attempt * 1000; // no header: 1s, 2s, 4s
}

/** Jira error bodies look like { errorMessages: [...], errors: { field: msg } }. */
async function jiraErrorDetail(response) {
  try {
    const body = await response.json();
    const messages = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})];
    return messages.join(' ');
  } catch {
    return '';
  }
}

function explain(status, path, detail) {
  const suffix = detail ? ` Jira says: ${detail}` : '';
  switch (status) {
    case 400:
      return `Jira rejected the request to ${path} (400).${suffix} If this is a search, check the JQL in config.json.`;
    case 401:
      return `Jira authentication failed (401). Check JIRA_EMAIL and JIRA_API_TOKEN in .env; the token must belong to that email.`;
    case 403:
      return `Jira denied access to ${path} (403). The account needs permission to browse the project.${suffix}`;
    case 404:
      return `Jira returned 404 for ${path}. Check JIRA_BASE_URL (e.g. https://your-site.atlassian.net).${suffix}`;
    default:
      return `Jira request to ${path} failed with ${status}.${suffix}`;
  }
}

/**
 * @param {{baseUrl: string, email: string, apiToken: string}} settings
 * @param {{fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>}} [deps] - injectable for tests
 */
export function createJiraClient({ baseUrl, email, apiToken }, deps = {}) {
  const fetchFn = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const auth = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;

  async function request(method, path, { query, body } = {}) {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchFn(url, {
          method,
          headers: {
            Authorization: auth,
            Accept: 'application/json',
            ...(body !== undefined && { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        throw new JiraError(`Could not reach Jira at ${baseUrl}: ${err.message}. Check JIRA_BASE_URL.`, { path });
      }

      if (RETRYABLE.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }
      if (!response.ok) {
        const detail = await jiraErrorDetail(response);
        throw new JiraError(explain(response.status, path, detail), { status: response.status, path });
      }
      return response.status === 204 ? null : response.json();
    }
  }

  return {
    baseUrl,
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
    put: (path, body) => request('PUT', path, { body }),
    delete: (path, query) => request('DELETE', path, { query }),
  };
}
