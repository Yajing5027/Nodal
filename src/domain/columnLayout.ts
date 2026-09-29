// ============================================================
// Column Layout Domain — 2- to 5-column markdown blocks
// Converts between column syntax and sequential content
// ============================================================
import type { Root, RootContent } from 'mdast';
import { toMarkdown } from 'mdast-util-to-markdown';

export function createColumnsMarkdown(columns: string[]): string {
  const count = Math.min(5, Math.max(2, columns.length));
  // Safe: Empty columns must never save 'Content...' placeholder
  const cols = columns.slice(0, count).map(c => (c ?? '').trim());
  const inner = cols.map(c => `<div class="nodal-col">\n\n${c}\n\n</div>`).join('\n\n');
  return `\n\n<div class="nodal-cols nodal-cols-${count}">\n\n${inner}\n\n</div>\n\n`;
}

export function revertColumnsToSingle(text: string): string {
  if (!text || !text.includes('nodal-cols')) return text;
  const openTag = /<div[^>]*class=["']nodal-cols\s+(nodal-cols-[2-5])["'][^>]*>/gi;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = openTag.exec(text)) !== null) {
    result += text.slice(lastIndex, match.index);
    const startPos = match.index + match[0].length;
    let depth = 1;
    let pos = startPos;
    const tagRegex = /<\/?div[^>]*>/gi;
    tagRegex.lastIndex = pos;
    let tagMatch: RegExpExecArray | null;
    let endPos = text.length;

    while ((tagMatch = tagRegex.exec(text)) !== null) {
      if (tagMatch[0].startsWith('</')) {
        depth--;
        if (depth === 0) {
          endPos = tagMatch.index + tagMatch[0].length;
          break;
        }
      } else {
        depth++;
      }
    }

    const blockInner = text.slice(startPos, Math.max(startPos, endPos - 6));
    const colRegex = /<div[^>]*class=["']nodal-col["'][^>]*>([\s\S]*?)<\/div>/gi;
    const parts: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = colRegex.exec(blockInner)) !== null) {
      const colText = cm[1].trim();
      if (colText) parts.push(colText);
    }
    result += parts.join('\n\n');
    lastIndex = endPos;
    openTag.lastIndex = endPos;
  }

  result += text.slice(lastIndex);
  return result;
}

/**
 * Remark plugin to transform HTML div tags representing column blocks
 * into structured AST elements rendered as CSS grid columns.
 */
export function remarkNodalColumns() {
  return (tree: Root) => {
    const newChildren: RootContent[] = [];
    let currentCols: any = null;
    let currentCol: any = null;

    for (const node of tree.children) {
      if (node.type === 'html') {
        const val = (node as { value: string }).value.trim();
        const startColsMatch = val.match(/<div[^>]*class=["']nodal-cols\s+(nodal-cols-[2-5])["'][^>]*>/i);
        const startColMatch = val.match(/<div[^>]*class=["']nodal-col["'][^>]*>/i);
        const hasCloseDiv = /<\/div>/i.test(val);

        if (startColsMatch) {
          currentCols = {
            type: 'blockquote',
            data: { hName: 'div', hProperties: { className: `nodal-cols ${startColsMatch[1]}` } },
            children: [],
          };
          if (startColMatch) {
            currentCol = {
              type: 'blockquote',
              data: { hName: 'div', hProperties: { className: 'nodal-col' } },
              children: [],
            };
            currentCols.children.push(currentCol);
          }
          continue;
        }

        if (startColMatch && currentCols) {
          currentCol = {
            type: 'blockquote',
            data: { hName: 'div', hProperties: { className: 'nodal-col' } },
            children: [],
          };
          currentCols.children.push(currentCol);
          continue;
        }

        if (hasCloseDiv && currentCols) {
          const closeCount = (val.match(/<\/div>/gi) || []).length;
          let remainingCloses = closeCount;
          if (currentCol && remainingCloses > 0) {
            currentCol = null;
            remainingCloses--;
          }
          if (remainingCloses > 0 && currentCols) {
            newChildren.push(currentCols);
            currentCols = null;
            remainingCloses--;
          }
          continue;
        }
      }

      if (currentCol) {
        currentCol.children.push(node);
      } else if (currentCols) {
        currentCol = {
          type: 'blockquote',
          data: { hName: 'div', hProperties: { className: 'nodal-col' } },
          children: [node],
        };
        currentCols.children.push(currentCol);
      } else {
        newChildren.push(node);
      }
    }

    if (currentCols) {
      newChildren.push(currentCols);
    }
    tree.children = newChildren;
  };
}

/**
 * MDAST transformer that groups HTML column markup into a structured nodalColumns AST node
 * for interactive WYSIWYG editing in MDXEditor.
 */
export function transformColumnsMdast(tree: Root) {
  const newChildren: RootContent[] = [];
  let inCols = false;
  let colCount = 2;
  let currentCols: string[] = [];
  let currentColNodes: any[] | null = null;

  for (let i = 0; i < tree.children.length; i++) {
    const node = tree.children[i];
    if (node.type === 'html') {
      const val = (node as { value: string }).value.trim();
      const openMatch = val.match(/<div[^>]*class=["']nodal-cols\s+nodal-cols-([2-5])["'][^>]*>/i);
      const colMatch = /<div[^>]*class=["']nodal-col["'][^>]*>/i.test(val);
      const closeDiv = /<\/div>/i.test(val);

      if (openMatch) {
        inCols = true;
        colCount = parseInt(openMatch[1], 10);
        currentCols = [];
        currentColNodes = null;
        continue;
      }
      if (inCols) {
        if (colMatch) {
          currentColNodes = [];
          continue;
        }
        if (closeDiv) {
          if (currentColNodes !== null) {
            const colMd = toMarkdown({ type: 'root', children: currentColNodes }).trim();
            currentCols.push(colMd);
            currentColNodes = null;
          } else {
            // Closing nodal-cols
            inCols = false;
            newChildren.push({
              type: 'nodalColumns',
              colCount,
              columns: currentCols,
            } as any);
            currentCols = [];
          }
          continue;
        }
      }
    }

    if (inCols) {
      if (currentColNodes) {
        currentColNodes.push(node);
      }
    } else {
      newChildren.push(node);
    }
  }

  tree.children = newChildren;
}
