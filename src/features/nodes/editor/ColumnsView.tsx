interface ColumnsViewProps {
  columns: string[];
  onChange: (columns: string[]) => void;
  onRemove: () => void;
  onUnwrap: (unwrappedText: string) => void;
}

export function ColumnsView({ columns, onChange, onRemove, onUnwrap }: ColumnsViewProps) {
  const colCount = Math.max(1, columns.length);

  const handleTextChange = (index: number, text: string) => {
    const next = [...columns];
    next[index] = text;
    onChange(next);
  };

  const handleAddColumn = () => {
    if (columns.length >= 5) return;
    onChange([...columns, '']);
  };

  const handleMergeAndDeleteColumn = (index: number) => {
    if (columns.length <= 1) {
      onRemove();
      return;
    }
    const currentText = columns[index].trim();
    const next = [...columns];

    // Safely merge text into neighbor so no content is lost
    if (index > 0) {
      const neighbor = next[index - 1].trim();
      next[index - 1] = neighbor ? (currentText ? `${neighbor}\n\n${currentText}` : neighbor) : currentText;
    } else if (next.length > 1) {
      const neighbor = next[1].trim();
      next[1] = currentText ? (neighbor ? `${currentText}\n\n${neighbor}` : currentText) : neighbor;
    }

    next.splice(index, 1);
    if (next.length === 1) {
      // Unwrapped to single column
      onUnwrap(next[0]);
    } else {
      onChange(next);
    }
  };

  const handleUnwrapAll = () => {
    const merged = columns
      .map(c => c.trim())
      .filter(Boolean)
      .join('\n\n');
    onUnwrap(merged);
  };

  return (
    <div className="editor-columns-block" contentEditable={false}>
      <div className="editor-columns-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <strong style={{ color: 'var(--text)', fontSize: '12px' }}>
            Columns Layout ({colCount} {colCount === 1 ? 'column' : 'columns'})
          </strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {colCount < 5 && (
            <button
              type="button"
              className="ghost"
              onClick={handleAddColumn}
              title="Add another column (up to 5)"
              style={{ fontSize: '11px', padding: '2px 8px' }}
            >
              + Add column
            </button>
          )}
          <button
            type="button"
            className="ghost"
            onClick={handleUnwrapAll}
            title="Convert columns back to single continuous text"
            style={{ fontSize: '11px', padding: '2px 8px' }}
          >
            Revert to single
          </button>
          <button
            type="button"
            className="danger-quiet"
            onClick={onRemove}
            title="Delete this columns block"
            style={{ fontSize: '11px', padding: '2px 6px' }}
          >
            ✕
          </button>
        </div>
      </div>

      <div className={`nodal-cols nodal-cols-${colCount}`}>
        {columns.map((colText, idx) => (
          <div key={idx} className="editor-columns-col-card nodal-col">
            <div className="editor-columns-col-header">
              <span>Col {idx + 1}</span>
              {colCount > 1 && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => handleMergeAndDeleteColumn(idx)}
                  title={`Delete Col ${idx + 1} and safely merge its content into adjacent column`}
                  style={{
                    padding: '1px 5px',
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    borderRadius: '4px',
                  }}
                >
                  Merge &amp; Delete
                </button>
              )}
            </div>
            <textarea
              className="editor-columns-textarea"
              value={colText}
              placeholder={`Column ${idx + 1} content…`}
              onChange={e => handleTextChange(idx, e.target.value)}
              rows={Math.max(3, colText.split('\n').length)}
              spellCheck={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
