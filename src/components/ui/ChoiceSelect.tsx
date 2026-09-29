import { Children, isValidElement, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Option = { value: string; label: string; disabled: boolean };
interface Props {
  children: ReactNode;
  value?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type !== 'option') return optionsFrom(child.props.children);
    const label = Children.toArray(child.props.children).join('');
    return [{ value: String(child.props.value ?? label), label, disabled: !!child.props.disabled }];
  });
}

/** Presentation-only replacement for a select: small sets stay visible; long sets open a searchable sheet. */
export function ChoiceSelect({ children, value, onChange, disabled, id, className = '', style, 'aria-label': ariaLabel }: Props) {
  const options = optionsFrom(children);
  const selected = options.find(option => option.value === String(value));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const label = ariaLabel || 'Choose an option';
  const inline = options.length > 0 && options.length <= 4 && options.every(option => option.label.length < 30);
  useEffect(() => {
    if (!open) return;
    const returnFocus = trigger.current;
    (dialog.current?.querySelector<HTMLElement>('input') ?? dialog.current?.querySelector<HTMLElement>('[aria-pressed="true"]:not(:disabled)') ?? dialog.current?.querySelector<HTMLElement>('button'))?.focus();
    return () => { returnFocus?.focus(); };
  }, [open]);
  const choose = (option: Option) => {
    if (disabled || option.disabled) return;
    if (option.value !== String(value)) onChange?.({ target: { value: option.value } });
    setOpen(false);
  };
  if (inline) return <span id={id} className={`choice-segments ${className}`} role="group" aria-label={label} style={style}>
    {options.map(option => <button key={option.value} type="button" disabled={disabled || option.disabled} aria-pressed={option.value === String(value)} onClick={() => choose(option)}>{option.label}</button>)}
  </span>;
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <>
    <button ref={trigger} id={id} type="button" className={`choice-trigger ${className}`} style={style} disabled={disabled} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setQuery(''); setOpen(true); }}>
      <span>{selected?.label || 'Choose…'}</span><span className="choice-trigger-symbol" aria-hidden="true">↗</span>
    </button>
    {open && createPortal(<div className="choice-overlay" onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }} onClick={event => event.stopPropagation()}>
      <div ref={dialog} className="choice-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
        if (event.key === 'Tab') {
          const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])];
          if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
          if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const controls = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('.choice-list button:not(:disabled)') ?? [])];
          if (!controls.length) return;
          event.preventDefault();
          const current = controls.indexOf(document.activeElement as HTMLButtonElement);
          controls[(current + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length]?.focus();
        }
      }}>
        <header><h2 id={titleId}>{label}</h2><button type="button" aria-label="Close choices" onClick={() => setOpen(false)}>×</button></header>
        {options.length > 7 && <input type="search" aria-label="Search options" value={query} onChange={event => setQuery(event.target.value)} />}
        <div className="choice-list">{filtered.map(option => <button key={option.value} type="button" disabled={option.disabled} aria-pressed={option.value === String(value)} onClick={() => choose(option)}><span>{option.label}</span>{option.value === String(value) && <span aria-hidden="true">✓</span>}</button>)}{!filtered.length && <p>No matches</p>}</div>
      </div>
    </div>, document.body)}
  </>;
}
