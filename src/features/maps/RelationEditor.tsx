import { ChoiceSelect } from '../../components/ui/ChoiceSelect';
// ============================================================
// RelationEditor — inline floating editor for a selected relation
// Label input, direction select (none/forward/bidirectional),
// scope select (map/global). Delete button.
// ============================================================
import type { RelationDirection, RelationScope } from '../../domain/types';

interface RelationEditorProps {
  label: string;
  direction: RelationDirection;
  scope: RelationScope;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  x: number;
  y: number;
  onChange: (changes: {
    label?: string;
    direction?: RelationDirection;
    scope?: RelationScope;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }) => void;
  onReverse?: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function RelationEditor({
  label,
  direction,
  scope,
  sourceHandle,
  targetHandle,
  x,
  y,
  onChange,
  onReverse,
  onDelete,
  onClose,
}: RelationEditorProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        zIndex: 100,
        background: 'var(--surface)',
        border: '1px solid var(--selection-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        padding: 'var(--space-3)',
        width: 250,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 'var(--font-sm)' }}>Relation</span>
        <button
          className="ghost"
          onClick={onClose}
          style={{ padding: '0 4px', fontSize: 'var(--font-sm)' }}
          aria-label="Close relation editor"
        >
          ✕
        </button>
      </div>
      <input
        value={label}
        placeholder="Label (optional)…"
        onChange={(e) => onChange({ label: e.target.value })}
        style={{ fontSize: 'var(--font-sm)' }}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <ChoiceSelect
          aria-label="Direction"
          value={direction}
          onChange={(e) =>
            onChange({ direction: e.target.value as RelationDirection })
          }
          style={{ fontSize: 'var(--font-xs)', flex: 1 }}
        >
          <option value="none">No arrow</option>
          <option value="forward">→ Forward</option>
          <option value="bidirectional">↔ Both</option>
        </ChoiceSelect>
        <ChoiceSelect
          aria-label="Scope"
          value={scope}
          onChange={(e) => onChange({ scope: e.target.value as RelationScope })}
          style={{ fontSize: 'var(--font-xs)', flex: 1 }}
        >
          <option value="map">Map only</option>
          <option value="global">Global</option>
        </ChoiceSelect>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>From port</label>
          <ChoiceSelect
            aria-label="Source port"
            value={sourceHandle ?? 'auto'}
            onChange={(e) => onChange({ sourceHandle: e.target.value === 'auto' ? null : e.target.value })}
            style={{ fontSize: 'var(--font-xs)', width: '100%' }}
          >
            <option value="auto">Auto</option>
            <option value="top">Top</option>
            <option value="right">Right</option>
            <option value="bottom">Bottom</option>
            <option value="left">Left</option>
          </ChoiceSelect>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>To port</label>
          <ChoiceSelect
            aria-label="Target port"
            value={targetHandle ?? 'auto'}
            onChange={(e) => onChange({ targetHandle: e.target.value === 'auto' ? null : e.target.value })}
            style={{ fontSize: 'var(--font-xs)', width: '100%' }}
          >
            <option value="auto">Auto</option>
            <option value="top">Top</option>
            <option value="right">Right</option>
            <option value="bottom">Bottom</option>
            <option value="left">Left</option>
          </ChoiceSelect>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 2 }}>
        {onReverse && (
          <button
            type="button"
            className="ghost"
            onClick={onReverse}
            style={{ flex: 1, fontSize: 'var(--font-xs)' }}
            title="Swap source and target endpoints"
          >
            Reverse ⇄
          </button>
        )}
        <button
          type="button"
          className="danger"
          onClick={onDelete}
          style={{ flex: 1, fontSize: 'var(--font-xs)' }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
