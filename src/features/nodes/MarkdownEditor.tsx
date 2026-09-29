// ============================================================
// MarkdownEditor — wraps @mdxeditor/editor with all required plugins.
// The editor is UI state only; contentMarkdown in Dexie is canonical.
// Images inserted via upload/paste are stored as Asset blobs and
// referenced as ![alt](asset://<id>) in markdown, never base64.
// ============================================================
import { useCallback, useRef } from 'react';
import { TextStyleButtons } from './editor/TextStyleButtons';
import { InsertFormula } from './editor/InsertFormula';
import { InsertColumns } from './editor/InsertColumns';
import { mathPlugin } from './editor/mathPlugin';
import { columnsPlugin } from './editor/columnsPlugin';
import { clipboardMarkdown } from './editor/clipboardMarkdown';
import { useTheme } from '../../app/themeState';
import type { ID } from '../../domain/types';
import { createAsset } from '../../repositories/assetRepository';
import { resolveAssetUrl } from './assetResolver';
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  tablePlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  toolbarPlugin,
  thematicBreakPlugin,
  BoldItalicUnderlineToggles,
  CodeToggle,
  InsertCodeBlock,
  InsertTable,
  CreateLink,
  InsertImage,
  ListsToggle,
  diffSourcePlugin,
  DiffSourceToggleWrapper,
  UndoRedo,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';

interface MarkdownEditorProps {
  markdown: string;
  onChange: (markdown: string) => void;
  /** Called when an image is uploaded via the editor (inserted into markdown). */
  onAssetCreated?: (assetId: ID) => void;
}

const CODE_LANGUAGES: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  bash: 'Bash',
  sql: 'SQL',
  markdown: 'Markdown',
  plaintext: 'Plain Text',
};

export function MarkdownEditor({ markdown, onChange, onAssetCreated }: MarkdownEditorProps) {
  const { resolved } = useTheme();
  const editorRef = useRef<MDXEditorMethods>(null);
  const onAssetCreatedRef = useRef(onAssetCreated);
  onAssetCreatedRef.current = onAssetCreated;

  /**
   * Intercept image uploads: create an Asset blob in Dexie, then return
   * an asset://<id> URL that MDXEditor will insert into the markdown.
   * The imagePreviewHandler below resolves asset:// URLs for display.
   */
  const imageUploadHandler = useCallback(async (file: File): Promise<string> => {
    const asset = await createAsset({
      filename: file.name,
      mimeType: file.type,
      blob: file,
      description: '',
    });
    onAssetCreatedRef.current?.(asset.id);
    return `asset://${asset.id}`;
  }, []);

  /**
   * Resolve asset://<id> URLs to blob object URLs for rendering.
   * Regular http(s) URLs pass through unchanged.
   */
  const imagePreviewHandler = useCallback(async (imageSource: string): Promise<string> => {
    return resolveAssetUrl(imageSource);
  }, []);

  return (
    <div
      className="note-rich-editor"
      onPointerDownCapture={event => {
        const target = event.target as HTMLElement;
        if (!target.closest('[role="toolbar"]') || target.closest('[aria-label="Source mode"], [aria-label="Rich text"]')) return;
        const body = event.currentTarget.querySelector('[contenteditable="true"]');
        if (body && !body.contains(document.activeElement)) editorRef.current?.focus();
      }}
      onPasteCapture={event => {
        const target = event.target as HTMLElement;
        if (!target.closest('[contenteditable="true"]') || target.closest('.cm-editor, pre, code')) return;
        if (event.clipboardData.files.length) return; // Image upload owns asset creation.
        const markdown = clipboardMarkdown(event.clipboardData.getData('text/html'), event.clipboardData.getData('text/plain'));
        if (!markdown) return;
        event.preventDefault(); event.stopPropagation();
        editorRef.current?.insertMarkdown(markdown);
      }}
    >
      <MDXEditor
        className={resolved === 'dark' ? 'dark-theme' : ''}
        ref={editorRef}
        autoFocus
        markdown={markdown}
        onChange={(value, initialNormalize) => { if (!initialNormalize) onChange(value); }}
        contentEditableClassName="inspector-editor-content"
        plugins={[
          mathPlugin(),
          columnsPlugin(),
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: 'plaintext' }),
          codeMirrorPlugin({ codeBlockLanguages: CODE_LANGUAGES }),
          tablePlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          thematicBreakPlugin(),
          diffSourcePlugin({ viewMode: 'rich-text' }),
          imagePlugin({
            imageUploadHandler,
            imagePreviewHandler,
            disableImageResize: true,
          }),
          toolbarPlugin({
            toolbarContents: () => (
              <DiffSourceToggleWrapper options={['rich-text', 'source']}>
                <UndoRedo />
                <TextStyleButtons />
                <BoldItalicUnderlineToggles />
                <CodeToggle />
                <ListsToggle />
                <InsertTable />
                <InsertCodeBlock />
                <CreateLink />
                <InsertImage />
                <InsertFormula onInsert={value => editorRef.current?.insertMarkdown(value)} />
                <InsertColumns onInsert={value => editorRef.current?.insertMarkdown(value)} />
              </DiffSourceToggleWrapper>
            ),
          }),
        ]}
      />
    </div>
  );
}
