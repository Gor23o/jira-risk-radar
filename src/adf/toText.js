// Converts Atlassian Document Format (the JSON Jira uses for descriptions and
// comments) into readable plain text. Keeps structure that matters to a reader,
// such as bullets, numbering and checkboxes, because "does this ticket have acceptance
// criteria?" often depends on seeing a list.

const INDENT = '  ';

/** @param {object|string|null|undefined} adf @returns {string} */
export function adfToText(adf) {
  if (adf == null) return '';
  if (typeof adf === 'string') return adf.trim();
  return renderBlock(adf, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderInline(nodes = []) {
  return nodes.map(inlineNode).join('');
}

function inlineNode(node) {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'text':
      return node.text ?? '';
    case 'hardBreak':
      return '\n';
    case 'mention':
      return attrs.text || '@someone';
    case 'emoji':
      return attrs.text || attrs.shortName || '';
    case 'inlineCard':
    case 'blockCard':
      return attrs.url ?? '';
    case 'status':
      return `[${attrs.text ?? ''}]`;
    case 'date':
      return attrs.timestamp ? new Date(Number(attrs.timestamp)).toISOString().slice(0, 10) : '';
    default:
      return node.content ? renderInline(node.content) : (node.text ?? '');
  }
}

function renderBlocks(nodes = [], indent) {
  return nodes
    .map((node) => renderBlock(node, indent))
    .filter((text) => text !== '')
    .join('\n');
}

/** Prefixes every line of `text` with `indent`. */
function indentLines(text, indent) {
  return text
    .split('\n')
    .map((line) => indent + line)
    .join('\n');
}

function renderBlock(node, indent) {
  switch (node.type) {
    case 'doc':
      return renderBlocks(node.content, indent);
    case 'paragraph':
    case 'heading':
    case 'codeBlock':
      return indentLines(renderInline(node.content), indent);
    case 'bulletList':
      return renderList(node, indent, () => '- ');
    case 'orderedList': {
      const start = node.attrs?.order ?? 1;
      return renderList(node, indent, (i) => `${start + i}. `);
    }
    case 'taskList':
      return renderList(node, indent, (i, item) => (item.attrs?.state === 'DONE' ? '[x] ' : '[ ] '));
    case 'blockquote':
      return indentLines(renderBlocks(node.content, ''), `${indent}> `);
    case 'rule':
      return `${indent}---`;
    case 'table':
      return (node.content ?? [])
        .map((row) => indent + (row.content ?? []).map((cell) => renderBlocks(cell.content, '').replace(/\n/g, ' ')).join(' | '))
        .join('\n');
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return `${indent}[attachment]`;
    default:
      // panel, expand, decisionList, and anything new: keep the text, drop the chrome.
      if (!node.content) return indentLines(inlineNode(node), indent);
      return isInlineContent(node.content)
        ? indentLines(renderInline(node.content), indent)
        : renderBlocks(node.content, indent);
  }
}

function isInlineContent(nodes) {
  return nodes.every((n) => ['text', 'hardBreak', 'mention', 'emoji', 'inlineCard', 'status', 'date'].includes(n.type));
}

function renderList(list, indent, marker) {
  return (list.content ?? [])
    .map((item, i) => {
      const prefix = marker(i, item);
      // taskItem holds inline nodes; listItem holds blocks (paragraphs, nested lists).
      const body =
        item.type === 'taskItem' ? renderInline(item.content) : renderBlocks(item.content, '');
      const [first, ...rest] = body.split('\n');
      const continuation = rest.map((line) => indent + INDENT + line);
      return [indent + prefix + first, ...continuation].join('\n');
    })
    .join('\n');
}
