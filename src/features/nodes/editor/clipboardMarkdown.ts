import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Nodes } from 'mdast';

/** Decode numeric and common HTML entities without altering backslashes or code. */
export function decodeHtmlEntities(text: string): string {
  if (!text) return text;
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return !Number.isNaN(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return !Number.isNaN(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Normalize common LaTeX delimiters without touching code or escaped examples. */
export function normalizeMathDelimiters(source: string): string {
  const protectedCode: string[] = [];
  const token = `NODALCODE${crypto.randomUUID().replaceAll('-', '')}`;
  const ranges: Array<{ start: number; end: number }> = [];
  const visit = (node: Nodes) => {
    if (node.type === 'code' || node.type === 'inlineCode') {
      const start = node.position?.start.offset; const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
    } else if ('children' in node) node.children.forEach(visit);
  };
  visit(unified().use(remarkParse).parse(source));
  let safe = source;
  ranges.sort((a, b) => b.start - a.start).forEach(({ start, end }) => {
    protectedCode.push(source.slice(start, end));
    safe = safe.slice(0, start) + `${token}${protectedCode.length - 1}END` + safe.slice(end);
  });
  return safe.replace(/(?<!\\)\\\[\s*([\s\S]*?)\s*(?<!\\)\\\]/g, (_, formula) => `\n\n$$\n${formula}\n$$\n\n`)
    .replace(/(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g, (_, formula) => `$${formula}$`)
    .replace(new RegExp(`${token}(\\d+)END`, 'g'), (_, index) => protectedCode[Number(index)]);
}

/** Prefer semantic HTML, recover KaTeX/MathJax source, discard copied UI chrome. */
export function clipboardMarkdown(html: string, plain: string): string | null {
  if (!html.trim()) {
    const decoded = decodeHtmlEntities(plain);
    if (!/(^|\n)\s*(#{1,6} |[-*+] |\d+\. |```|~~~|\|)|\$|\\[([]|\*\*|\[[^\]]+\]\(|\n(?:[ \t\u00A0]*\n){2,}/.test(decoded)) return null;
    return normalizeMathDelimiters(decoded);
  }
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script,style,button,nav,svg,[aria-hidden="true"]:not(.katex-html)').forEach(element => element.remove());
  const formulas: string[] = [];
  const prefix = `NODALMATH${crypto.randomUUID().replaceAll('-', '')}`;
  document.querySelectorAll('.katex-display,.katex,mjx-container,math').forEach(element => {
    if (!element.isConnected) return;
    const source = element.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? element.getAttribute('data-latex') ?? element.querySelector('math')?.getAttribute('alttext') ?? element.getAttribute('alttext');
    if (!source) return;
    const display = element.classList.contains('katex-display') || element.getAttribute('display') === 'block' || element.getAttribute('display') === 'true';
    formulas.push(display ? `\n\n$$\n${source.trim()}\n$$\n\n` : `$${source.trim()}$`);
    element.replaceWith(document.createTextNode(`${prefix}${formulas.length - 1}END`));
  });
  document.querySelectorAll('img').forEach(image => { if (/^data:/i.test(image.getAttribute('src') ?? '')) image.replaceWith(document.createTextNode(image.alt)); });

  // Convert empty paragraphs or break-only paragraphs into newline placeholders so rich text empty runs aren't collapsed
  document.querySelectorAll('p').forEach(p => {
    const text = p.textContent?.trim() ?? '';
    const hasOnlyBr = p.children.length === 1 && p.children[0].nodeName === 'BR';
    if (!text && (p.children.length === 0 || hasOnlyBr)) {
      p.replaceWith(document.createTextNode('\n\n'));
    }
  });

  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**' });
  converter.use(gfm);
  converter.addRule('fenced-code-language', {
    filter: node => node.nodeName === 'PRE',
    replacement: (_, node) => {
      const code = (node as HTMLElement).querySelector('code');
      const language = code?.className.match(/(?:language|lang)-([\w+-]+)/)?.[1] ?? '';
      const text = (code ?? node).textContent?.replace(/\n$/, '') ?? '';
      const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length));
      const fence = '`'.repeat(longest + 1);
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    },
  });
  converter.addRule('safe-link', { filter: node => node.nodeName === 'A' && !/^(https?:|mailto:|asset:|#|\/)/i.test((node as HTMLElement).getAttribute('href') ?? ''), replacement: content => content });
  let markdown = converter.turndown(document.body.innerHTML).replace(new RegExp(`${prefix}(\\d+)END`, 'g'), (_, index) => formulas[Number(index)]);
  markdown = decodeHtmlEntities(markdown);
  return markdown.trim() || (plain ? normalizeMathDelimiters(decodeHtmlEntities(plain)) : null);
}
