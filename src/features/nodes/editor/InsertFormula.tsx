import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import katex from 'katex';

export function InsertFormula({ onInsert }: { onInsert: (markdown: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <>
    <button ref={trigger} type="button" className="insert-formula" aria-label="Insert formula" title="Insert formula" onPointerDown={event => event.preventDefault()} onClick={() => { setDraft(''); setOpen(true); }}>∑</button>
    {open && createPortal(<div className="formula-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <form className="formula-dialog" role="dialog" aria-modal="true" aria-label="Insert formula" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)')];
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} onSubmit={event => {
        event.preventDefault();
        if (!draft.trim()) return;
        close();
        onInsert('\n\n$$\n' + draft.trim() + '\n$$\n\n');
      }}>
        <h2>Insert formula</h2>
        <label>LaTeX<textarea ref={input} value={draft} placeholder="Enter a formula" onChange={event => setDraft(event.target.value)} rows={4} spellCheck={false} /></label>
        <div className="formula-preview" dangerouslySetInnerHTML={{ __html: katex.renderToString(draft, { displayMode: true, throwOnError: false, strict: false, trust: false }) }} />
        <footer><button type="button" onClick={close}>Cancel</button><button type="submit" className="primary" disabled={!draft.trim()}>Insert</button></footer>
      </form>
    </div>, document.body)}
  </>;
}
