import { describe, expect, it } from 'vitest';
import { createJiraClient, JiraError, readJiraEnv } from '../../src/jira/client.js';

const settings = { baseUrl: 'https://example.atlassian.net', email: 'me@example.com', apiToken: 'secret' };

function jsonResponse(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

/** Fake fetch that returns queued responses and records requests. */
function fakeFetch(...responses) {
  const requests = [];
  const fn = async (url, init) => {
    requests.push({ url: String(url), ...init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.requests = requests;
  return fn;
}

const noSleep = { sleeps: [], sleep: async (ms) => noSleep.sleeps.push(ms) };

describe('readJiraEnv', () => {
  it('lists every missing variable', () => {
    expect(() => readJiraEnv({ JIRA_BASE_URL: 'https://x.atlassian.net' })).toThrow(
      'Missing JIRA_EMAIL, JIRA_API_TOKEN',
    );
  });

  it('points to .env locally and to the GitHub environment secrets on Actions', () => {
    expect(() => readJiraEnv({})).toThrow(/Copy \.env\.example to \.env/);
    expect(() => readJiraEnv({ GITHUB_ACTIONS: 'true' })).toThrow(/secrets of the GitHub environment/);
  });

  it('trims values and a trailing slash on the URL', () => {
    const env = readJiraEnv({ JIRA_BASE_URL: ' https://x.atlassian.net/ ', JIRA_EMAIL: 'a@b.c ', JIRA_API_TOKEN: ' t' });
    expect(env).toEqual({ baseUrl: 'https://x.atlassian.net', email: 'a@b.c', apiToken: 't' });
  });
});

describe('createJiraClient', () => {
  it('sends Basic auth, JSON headers and query parameters', async () => {
    const fetch = fakeFetch(jsonResponse(200, { ok: true }));
    const client = createJiraClient(settings, { fetch });
    await client.get('/rest/api/3/issue/RAD-1/changelog', { startAt: 0, maxResults: 100 });

    const [request] = fetch.requests;
    expect(request.url).toBe('https://example.atlassian.net/rest/api/3/issue/RAD-1/changelog?startAt=0&maxResults=100');
    expect(request.headers.Authorization).toBe(`Basic ${Buffer.from('me@example.com:secret').toString('base64')}`);
    expect(request.headers.Accept).toBe('application/json');
  });

  it('posts a JSON body', async () => {
    const fetch = fakeFetch(jsonResponse(200, { issues: [] }));
    await createJiraClient(settings, { fetch }).post('/rest/api/3/search/jql', { jql: 'project = RAD' });
    expect(fetch.requests[0].method).toBe('POST');
    expect(fetch.requests[0].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(fetch.requests[0].body)).toEqual({ jql: 'project = RAD' });
  });

  it('supports PUT and DELETE, returning null for 204 No Content', async () => {
    const fetch = fakeFetch(new Response(null, { status: 204 }), new Response(null, { status: 204 }));
    const client = createJiraClient(settings, { fetch });
    expect(await client.put('/rest/api/3/issue/SCRUM-1', { fields: { duedate: null } })).toBeNull();
    expect(await client.delete('/rest/api/3/issue/SCRUM-1')).toBeNull();
    expect(fetch.requests.map((r) => r.method)).toEqual(['PUT', 'DELETE']);
    expect(JSON.parse(fetch.requests[0].body)).toEqual({ fields: { duedate: null } });
  });

  it('retries a 429 after the Retry-After delay', async () => {
    noSleep.sleeps.length = 0;
    const fetch = fakeFetch(jsonResponse(429, {}, { 'Retry-After': '2' }), jsonResponse(200, { done: true }));
    const result = await createJiraClient(settings, { fetch, sleep: noSleep.sleep }).get('/x');
    expect(result).toEqual({ done: true });
    expect(noSleep.sleeps).toEqual([2000]);
  });

  it('gives up after 3 retries', async () => {
    const limited = () => jsonResponse(429, {});
    const fetch = fakeFetch(limited(), limited(), limited(), limited());
    await expect(createJiraClient(settings, { fetch, sleep: async () => {} }).get('/x')).rejects.toMatchObject({ status: 429 });
    expect(fetch.requests).toHaveLength(4);
  });

  it('explains a 401 in terms of .env', async () => {
    const fetch = fakeFetch(jsonResponse(401, {}));
    await expect(createJiraClient(settings, { fetch }).get('/x')).rejects.toThrow(/JIRA_EMAIL and JIRA_API_TOKEN/);
  });

  it("includes Jira's own message for a bad JQL (400)", async () => {
    const fetch = fakeFetch(jsonResponse(400, { errorMessages: ["The value 'NOPE' does not exist for the field 'project'."] }));
    const error = await createJiraClient(settings, { fetch }).post('/rest/api/3/search/jql', {}).catch((e) => e);
    expect(error).toBeInstanceOf(JiraError);
    expect(error.status).toBe(400);
    expect(error.message).toContain("The value 'NOPE' does not exist");
    expect(error.message).toContain('check the JQL');
  });

  it('points at JIRA_BASE_URL when the host is unreachable', async () => {
    const fetch = fakeFetch(new TypeError('fetch failed'));
    await expect(createJiraClient(settings, { fetch }).get('/x')).rejects.toThrow(/Could not reach Jira.*JIRA_BASE_URL/);
  });
});
