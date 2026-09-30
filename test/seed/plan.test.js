import { describe, expect, it } from 'vitest';
import { adfToText } from '../../src/adf/toText.js';
import { createFields, dueDateFor, finalStatus, refreshTransitions, resolveAssignee, toAdf } from '../../src/seed/plan.js';

const MON_FRI = [1, 2, 3, 4, 5];
const scenario = {
  summary: 'Saved cards list',
  type: 'Story',
  priority: 'High',
  path: ['In Progress'],
  dueInBusinessDays: 2,
  description: 'First paragraph.\n\nSecond paragraph.',
  acceptanceCriteria: ['Cards show last four digits', 'Expired cards are disabled'],
  refresh: true,
};
const ctx = {
  projectKey: 'SCRUM',
  label: 'seed-demo',
  dueDate: '2026-10-02',
  assigneeId: 'acc-1',
  sprintId: 2,
  customFieldIds: { sprint: 'customfield_10020', flagged: 'customfield_10021' },
};

describe('toAdf', () => {
  it('round-trips through our ADF reader with paragraphs and a criteria list', () => {
    expect(adfToText(toAdf(scenario.description, scenario.acceptanceCriteria))).toBe(
      'First paragraph.\nSecond paragraph.\nAcceptance criteria\n- Cards show last four digits\n- Expired cards are disabled',
    );
  });

  it('has no criteria section when there are none (vague tickets)', () => {
    expect(adfToText(toAdf('Make the checkout better.'))).toBe('Make the checkout better.');
  });
});

describe('dueDateFor', () => {
  it('counts business days from the anchor date, in both directions', () => {
    expect(dueDateFor({ dueInBusinessDays: 2 }, '2026-10-01', MON_FRI)).toBe('2026-10-05');
    expect(dueDateFor({ dueInBusinessDays: -1 }, '2026-10-05', MON_FRI)).toBe('2026-10-02');
  });

  it('keeps "no due date" as null', () => {
    expect(dueDateFor({ dueInBusinessDays: null }, '2026-10-01', MON_FRI)).toBeNull();
  });
});

describe('createFields', () => {
  it('builds the create payload with label, sprint, due date and assignee', () => {
    const fields = createFields(scenario, ctx);
    expect(fields).toMatchObject({
      project: { key: 'SCRUM' },
      issuetype: { name: 'Story' },
      summary: 'Saved cards list',
      priority: { name: 'High' },
      labels: ['seed-demo'],
      assignee: { accountId: 'acc-1' },
      duedate: '2026-10-02',
      customfield_10020: 2,
    });
    expect(fields.customfield_10021).toBeUndefined();
  });

  it('sets the Jira flag and an explicit unassigned value', () => {
    const fields = createFields({ ...scenario, flagged: true }, { ...ctx, assigneeId: null, dueDate: null, sprintId: null });
    expect(fields.customfield_10021).toEqual([{ value: 'Impediment' }]);
    expect(fields.assignee).toBeNull();
    expect(fields).not.toHaveProperty('duedate');
    expect(fields).not.toHaveProperty('customfield_10020');
  });
});

describe('refreshTransitions', () => {
  const options = { viaStatus: 'To Do', doneCategory: false };

  it('moves a healthy issue out via To Do and straight back', () => {
    expect(refreshTransitions(scenario, 'In QA', options)).toEqual(['To Do', 'In QA']);
  });

  it('leaves stuck candidates, finished issues and To Do issues alone', () => {
    expect(refreshTransitions({ ...scenario, refresh: false }, 'In Review', options)).toEqual([]);
    expect(refreshTransitions(scenario, 'Done', { ...options, doneCategory: true })).toEqual([]);
    expect(refreshTransitions(scenario, 'To Do', options)).toEqual([]);
  });
});

describe('finalStatus / resolveAssignee', () => {
  it('reads the last status of the path, To Do when empty', () => {
    expect(finalStatus({ path: ['In Progress', 'Blocked'] })).toBe('Blocked');
    expect(finalStatus({ path: [] })).toBe('To Do');
  });

  it('rotates teammates and falls back to me when there are none', () => {
    const people = { myId: 'me', teammateIds: ['t1', 't2'] };
    expect([0, 1, 2].map((i) => resolveAssignee('teammate', people, i))).toEqual(['t1', 't2', 't1']);
    expect(resolveAssignee('teammate', { myId: 'me', teammateIds: [] }, 0)).toBe('me');
    expect(resolveAssignee('me', people, 0)).toBe('me');
    expect(resolveAssignee(null, people, 0)).toBeNull();
  });
});
