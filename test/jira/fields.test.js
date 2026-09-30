import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findCustomFieldIds, findUnknownStatusNames } from '../../src/jira/fields.js';

const fields = JSON.parse(readFileSync(new URL('../fixtures/jira/fields.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../../config.json', import.meta.url), 'utf8'));

describe('findCustomFieldIds', () => {
  it('finds Sprint by its schema type and Flagged by name + type', () => {
    expect(findCustomFieldIds(fields)).toEqual({ sprint: 'customfield_10020', flagged: 'customfield_10021' });
  });

  it('returns null for fields the site does not have', () => {
    expect(findCustomFieldIds(fields.filter((f) => !f.custom))).toEqual({ sprint: null, flagged: null });
  });
});

describe('findUnknownStatusNames', () => {
  const workflow = ['To Do', 'In Progress', 'In Review', 'Ready for QA', 'In QA', 'Done', 'Blocked'].map((name) => ({ name }));

  it('accepts a config that matches the workflow (case-insensitive)', () => {
    const lowercase = workflow.map((s) => ({ name: s.name.toLowerCase() }));
    expect(findUnknownStatusNames(config, lowercase)).toEqual([]);
  });

  it('reports configured statuses Jira does not have', () => {
    const withoutBlocked = workflow.filter((s) => s.name !== 'Blocked' && s.name !== 'In Review');
    expect(findUnknownStatusNames(config, withoutBlocked)).toEqual(['In Review', 'Blocked']);
  });
});
