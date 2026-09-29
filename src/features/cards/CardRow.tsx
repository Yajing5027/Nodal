import type { ReactNode } from 'react';

export function CardRow({
  title,
  excerpt,
  tags,
  meta,
  label,
  selectable,
  selected,
  onToggleSelect,
  onOpen,
  reorderControls,
  onMouseDown,
  onMouseEnter,
}: {
  title: string;
  excerpt: string;
  tags?: ReactNode;
  meta?: ReactNode;
  label: string;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onOpen: () => void;
  onDelete?: () => void;
  reorderControls?: ReactNode;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
}) {
  return (
    <div className={`knowledge-card-row-wrapper${selected ? ' is-selected' : ''}`}>
      {reorderControls}
      <button
        className={`knowledge-card-row${selected ? ' is-selected' : ''}`}
        onClick={selectable ? onToggleSelect : onOpen}
        onMouseDown={onMouseDown}
        onMouseEnter={onMouseEnter}
        onKeyDown={selectable ? (e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onToggleSelect?.();
          }
        } : undefined}
        role={selectable ? 'checkbox' : undefined}
        aria-checked={selectable ? !!selected : undefined}
        aria-label={label}
      >
        <span className="card-row-content">
          <strong className="card-row-title">{title}</strong>
          <span className="card-row-excerpt">{excerpt}</span>
          {tags && <span className="card-row-tags">{tags}</span>}
        </span>
        <span className="card-row-meta">
          {meta}
          <span>Preview ↗</span>
        </span>
      </button>
    </div>
  );
}

