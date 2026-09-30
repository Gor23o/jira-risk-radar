import { describe, expect, it } from 'vitest';
import { adfToText } from '../../src/adf/toText.js';

const doc = (...content) => ({ type: 'doc', version: 1, content });
const text = (value, marks) => ({ type: 'text', text: value, ...(marks && { marks }) });
const p = (...content) => ({ type: 'paragraph', content });
const li = (...content) => ({ type: 'listItem', content });

describe('adfToText', () => {
  it('returns an empty string for missing content and passes plain strings through', () => {
    expect(adfToText(null)).toBe('');
    expect(adfToText(undefined)).toBe('');
    expect(adfToText('  already text  ')).toBe('already text');
  });

  it('drops formatting marks but keeps the text', () => {
    const adf = doc(p(text('Goal: ', [{ type: 'strong' }]), text('ship it', [{ type: 'em' }])));
    expect(adfToText(adf)).toBe('Goal: ship it');
  });

  it('puts paragraphs and headings on their own lines', () => {
    const adf = doc({ type: 'heading', attrs: { level: 2 }, content: [text('Context')] }, p(text('One.')), p(text('Two.')));
    expect(adfToText(adf)).toBe('Context\nOne.\nTwo.');
  });

  it('renders bullet and numbered lists, honouring the start number', () => {
    const adf = doc(
      { type: 'bulletList', content: [li(p(text('first'))), li(p(text('second')))] },
      { type: 'orderedList', attrs: { order: 3 }, content: [li(p(text('third'))), li(p(text('fourth')))] },
    );
    expect(adfToText(adf)).toBe('- first\n- second\n3. third\n4. fourth');
  });

  it('indents nested lists', () => {
    const adf = doc({
      type: 'bulletList',
      content: [li(p(text('parent')), { type: 'bulletList', content: [li(p(text('child')))] })],
    });
    expect(adfToText(adf)).toBe('- parent\n  - child');
  });

  it('renders task lists as checkboxes (common for acceptance criteria)', () => {
    const adf = doc({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { state: 'DONE' }, content: [text('API returns 200')] },
        { type: 'taskItem', attrs: { state: 'TODO' }, content: [text('Errors are logged')] },
      ],
    });
    expect(adfToText(adf)).toBe('[x] API returns 200\n[ ] Errors are logged');
  });

  it('handles hard breaks, mentions, emoji, links, status lozenges and dates', () => {
    const adf = doc(
      p(
        { type: 'mention', attrs: { id: 'x', text: '@Sam Lee' } },
        text(' waiting on '),
        { type: 'inlineCard', attrs: { url: 'https://example.com/PR-1' } },
        { type: 'hardBreak' },
        { type: 'status', attrs: { text: 'BLOCKED' } },
        text(' since '),
        { type: 'date', attrs: { timestamp: '1790208000000' } },
        text(' '),
        { type: 'emoji', attrs: { shortName: ':warning:', text: '⚠️' } },
      ),
    );
    expect(adfToText(adf)).toBe('@Sam Lee waiting on https://example.com/PR-1\n[BLOCKED] since 2026-09-24 ⚠️');
  });

  it('prefixes quotes, marks attachments and flattens tables', () => {
    const cell = (value) => ({ type: 'tableCell', content: [p(text(value))] });
    const adf = doc(
      { type: 'blockquote', content: [p(text('quoted'))] },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'm1' } }] },
      { type: 'table', content: [{ type: 'tableRow', content: [cell('a'), cell('b')] }] },
    );
    expect(adfToText(adf)).toBe('> quoted\n[attachment]\na | b');
  });

  it('keeps the text of unknown container nodes such as panels', () => {
    const adf = doc({ type: 'panel', attrs: { panelType: 'info' }, content: [p(text('Heads up'))] });
    expect(adfToText(adf)).toBe('Heads up');
  });

  it('skips empty paragraphs', () => {
    expect(adfToText(doc(p(), p(text('only line')), p()))).toBe('only line');
  });
});
