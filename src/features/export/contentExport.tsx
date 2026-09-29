import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import JSZip from 'jszip';
import type { KnowledgeNode } from '../../domain/types';
import { splitNotePanels } from '../../domain/notePanels';
import { expandTransclusionsToMarkdown, sectionLabel } from '../../domain/sectionTransclusion';
import { stripStorageDirectives } from './exporter';
import { db } from '../../db/database';
import { remarkNodalColumns } from '../../domain/columnLayout';

export function buildNoteExport(node: KnowledgeNode, selectedIds: string[], includeGuidance: boolean, request: string, getNode: (id: string) => KnowledgeNode | undefined): string {
  const panels = splitNotePanels(node.contentMarkdown).filter(panel => selectedIds.includes(panel.id));
  const parts = [`# ${node.title || 'Untitled note'}`];
  if (request.trim()) parts.push(`## This session's request\n\n${request.trim()}`);
  if (includeGuidance && node.aiGuidance?.note.trim()) parts.push(`## Guidance · whole note\n\n${node.aiGuidance.note.trim()}`);
  panels.forEach((panel, index) => {
    parts.push(`## Section ${index + 1} · ${sectionLabel(panel.markdown, index)}`);
    parts.push(stripStorageDirectives(expandTransclusionsToMarkdown(panel.markdown, getNode)));
    if (includeGuidance && node.aiGuidance?.sections[panel.id]?.trim()) parts.push(`### Guidance · this section\n\n${node.aiGuidance.sections[panel.id].trim()}`);
  });
  return parts.join('\n\n');
}

const safeUrlTransform = (url: string) => {
  if (url.startsWith('data:image/')) return url;
  if (/^(https?:|mailto:|tel:|\/|\.\/)/i.test(url)) return url;
  return '';
};

export function exportHtml(markdown: string): string {
  return renderToStaticMarkup(
    <article>
      <Markdown remarkPlugins={[remarkGfm, remarkMath, remarkNodalColumns]} rehypePlugins={[rehypeKatex]} urlTransform={safeUrlTransform}>
        {markdown}
      </Markdown>
    </article>
  );
}

export async function describeExportAssets(markdown: string): Promise<string> {
  const ids = [...new Set([...markdown.matchAll(/asset:\/\/([\w-]+)/g)].map(match => match[1]))];
  let result = markdown;
  for (const id of ids) {
    const asset = await db.assets.get(id);
    const description = asset ? `Image: ${asset.filename}${asset.description ? ` — ${asset.description}` : ' (attach the original image separately)'}` : 'Image unavailable';
    result = result.replace(new RegExp(`!\\[([^\\]]*)\\]\\(asset:\\/\\/${id}\\)`, 'g'), (_all, alt: string) => `[${alt ? alt + ' · ' : ''}${description}]`);
  }
  return result;
}

export async function copyFormattedText(markdown: string): Promise<'formatted' | 'markdown'> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([markdown], {type:'text/plain'}), 'text/html': new Blob([exportHtml(markdown)], {type:'text/html'}) })]);
      return 'formatted';
    } catch { /* Markdown fallback. */ }
  }
  await navigator.clipboard.writeText(markdown);
  return 'markdown';
}

export function downloadText(markdown: string, title: string) {
  const url = URL.createObjectURL(new Blob([markdown], {type:'text/markdown;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `${title.replace(/[\\/:*?"<>|]/g, '_') || 'note'}.md`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof blob.arrayBuffer === 'function') {
    const buffer = await blob.arrayBuffer();
    if (typeof Buffer !== 'undefined') {
      return `data:${blob.type || 'image/png'};base64,${Buffer.from(buffer).toString('base64')}`;
    }
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    const chunkSize = 16384;
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)) as any);
    }
    return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  return '';
}

export async function resolveMarkdownAssetsForPrint(markdown: string): Promise<{ resolvedMarkdown: string; missingAssets: string[] }> {
  const ids = [...new Set([...markdown.matchAll(/asset:\/\/([\w-]+)/g)].map(m => m[1]))];
  let resolved = markdown;
  const missingAssets: string[] = [];
  for (const id of ids) {
    const asset = await db.assets.get(id);
    if (asset && asset.blob) {
      try {
        const dataUrl = await blobToDataUrl(asset.blob);
        resolved = resolved.replace(new RegExp(`asset:\\/\\/${id}`, 'g'), dataUrl);
      } catch {
        missingAssets.push(id);
      }
    } else {
      missingAssets.push(id);
      resolved = resolved.replace(new RegExp(`!\\[([^\\]]*)\\]\\(asset:\\/\\/${id}\\)`, 'g'), `*(Missing Image: ${id})*`);
    }
  }
  return { resolvedMarkdown: resolved, missingAssets };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, m => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return m;
    }
  });
}

export function buildPrintHtml(title: string, markdown: string, scopeText: string): string {
  const renderedArticle = renderToStaticMarkup(
    <article className="nodal-print-document">
      <header className="nodal-print-header">
        <h1>{title || 'Untitled note'}</h1>
        <p className="nodal-print-scope">{scopeText}</p>
      </header>
      <Markdown remarkPlugins={[remarkGfm, remarkMath, remarkNodalColumns]} rehypePlugins={[rehypeKatex]} urlTransform={safeUrlTransform}>
        {markdown}
      </Markdown>
    </article>
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title || 'Note')}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.18.7/dist/katex.min.css">
  <style>
    @page {
      margin: 18mm 15mm;
      size: A4 portrait;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1a1a1a;
      background: #ffffff;
      line-height: 1.6;
      font-size: 11pt;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .nodal-print-header {
      border-bottom: 2px solid #222;
      padding-bottom: 12px;
      margin-bottom: 24px;
    }
    .nodal-print-header h1 {
      margin: 0 0 6px 0;
      font-size: 22pt;
      font-weight: 700;
      color: #111;
    }
    .nodal-print-scope {
      margin: 0;
      font-size: 9pt;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    h1, h2, h3, h4, h5, h6 {
      color: #111;
      break-after: avoid;
      page-break-after: avoid;
    }
    h2 {
      font-size: 15pt;
      margin-top: 24px;
      margin-bottom: 10px;
      border-bottom: 1px solid #e5e5e5;
      padding-bottom: 4px;
    }
    h3 {
      font-size: 12.5pt;
      margin-top: 18px;
      margin-bottom: 8px;
    }
    p, ul, ol, blockquote {
      margin-top: 0;
      margin-bottom: 12px;
    }
    blockquote {
      border-left: 3px solid #ccc;
      padding-left: 12px;
      color: #555;
      font-style: italic;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 9.5pt;
      background: #f4f5f7;
      padding: 2px 5px;
      border-radius: 3px;
      border: 1px solid #e1e4e8;
    }
    pre {
      background: #f6f8fa;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 12px 14px;
      overflow-x: auto;
      break-inside: avoid;
      page-break-inside: avoid;
      margin: 14px 0;
    }
    pre code {
      background: none;
      border: none;
      padding: 0;
      font-size: 9.5pt;
      white-space: pre-wrap;
      word-break: break-all;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 16px 0;
      break-inside: avoid;
      page-break-inside: avoid;
      font-size: 10pt;
    }
    th, td {
      border: 1px solid #d0d7de;
      padding: 8px 10px;
      text-align: left;
    }
    th {
      background: #f6f8fa;
      font-weight: 600;
    }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 16px auto;
      break-inside: avoid;
      page-break-inside: avoid;
      border-radius: 4px;
    }
    .nodal-cols {
      display: flex;
      gap: 16px;
      margin: 14px 0;
      width: 100%;
    }
    .nodal-cols-2 > .nodal-col {
      flex: 1 1 50%;
      min-width: 0;
    }
    .nodal-cols-3 > .nodal-col {
      flex: 1 1 33.333%;
      min-width: 0;
    }
    .nodal-col {
      word-break: break-word;
      min-width: 0;
    }
    .katex-display {
      margin: 12px 0;
      overflow-x: auto;
      overflow-y: hidden;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  ${renderedArticle}
</body>
</html>`;
}

export async function printNoteDocument(title: string, markdown: string, scopeText: string): Promise<{ missingAssets: string[]; blobUrl?: string }> {
  const { resolvedMarkdown, missingAssets } = await resolveMarkdownAssetsForPrint(markdown);
  const html = buildPrintHtml(title, resolvedMarkdown, scopeText);

  let blobUrl: string | undefined;
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    blobUrl = URL.createObjectURL(blob);
  } catch {
    // Ignore blob creation error in headless/mock environments
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error('Could not access print document.');
  }

  doc.open();
  doc.write(html);
  doc.close();

  // Wait for images and fonts to finish decoding
  await new Promise<void>(resolve => {
    const checkReady = () => {
      if (doc.readyState === 'complete') {
        const imgs = Array.from(doc.images);
        Promise.all(imgs.map(img => img.decode().catch(() => {}))).then(() => {
          if (doc.fonts?.ready) {
            doc.fonts.ready.then(() => resolve()).catch(() => resolve());
          } else {
            resolve();
          }
        });
      } else {
        setTimeout(checkReady, 50);
      }
    };
    checkReady();
  });

  try {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  } catch {
    // Browser print blocked or restricted
  }

  setTimeout(() => {
    if (document.body.contains(iframe)) {
      document.body.removeChild(iframe);
    }
  }, 2000);

  return { missingAssets, blobUrl };
}

export async function downloadMarkdownWithAssets(title: string, markdown: string): Promise<{ assetCount: number; missingAssets: string[] }> {
  const zip = new JSZip();
  const ids = [...new Set([...markdown.matchAll(/asset:\/\/([\w-]+)/g)].map(m => m[1]))];
  let updatedMarkdown = markdown;
  let assetCount = 0;
  const missingAssets: string[] = [];
  const assetsFolder = zip.folder('assets');

  for (const id of ids) {
    const asset = await db.assets.get(id);
    if (asset && asset.blob) {
      const ext = asset.filename ? asset.filename.split('.').pop() || 'png' : 'png';
      const cleanFilename = `${id}.${ext}`;
      assetsFolder?.file(cleanFilename, asset.blob);
      updatedMarkdown = updatedMarkdown.replace(new RegExp(`asset:\\/\\/${id}`, 'g'), `./assets/${cleanFilename}`);
      assetCount++;
    } else {
      missingAssets.push(id);
    }
  }

  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_') || 'note';
  zip.file(`${safeTitle}.md`, updatedMarkdown);

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeTitle}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { assetCount, missingAssets };
}

