import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export function MathView({ formula, display, onSave }: { formula: string; display: boolean; onSave: (formula: string) => void }) {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(formula);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const rendered = (value: string) => ({ __html: katex.renderToString(value, { displayMode: display, throwOnError: false, strict: false, trust: false }) });
  return <><button ref={trigger} type="button" className="editor-math" aria-label={`Edit formula: ${formula}`} onClick={() => { setDraft(formula); setOpen(true); }} dangerouslySetInnerHTML={rendered(formula)} />
    {open && createPortal(<div className="formula-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <form className="formula-dialog" role="dialog" aria-modal="true" aria-label="Edit formula" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Tab') { const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('textarea, button')]; const first = controls[0]; const last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
      }} onSubmit={event => { event.preventDefault(); editor.update(() => onSave(draft.trim())); close(); }}>
        <h2>Edit formula</h2><label>LaTeX<textarea ref={input} value={draft} onChange={event => setDraft(event.target.value)} rows={4} spellCheck={false} /></label>
        <div className="formula-preview" dangerouslySetInnerHTML={rendered(draft)} />
        <footer><button type="button" onClick={close}>Cancel</button><button className="primary" type="submit">Save formula</button></footer>
      </form></div>, document.body)}
  </>;
}

