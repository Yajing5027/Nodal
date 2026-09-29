import { createColumnsMarkdown } from '../../../domain/columnLayout';

interface InsertColumnsProps {
  onInsert: (markdown: string) => void;
}

export function InsertColumns({ onInsert }: InsertColumnsProps) {
  const handleClick = () => {
    // Directly insert 2 columns into editor without popup dialog
    const markdown = createColumnsMarkdown(['', '']);
    onInsert(markdown);
  };

  return (
    <button
      type="button"
      className="insert-columns-button"
      aria-label="Insert columns layout"
      title="Insert columns layout (2–5 columns)"
      onPointerDown={e => e.preventDefault()}
      onClick={handleClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        padding: '4px',
        background: 'transparent',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        transition: 'background 0.12s ease',
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="7" height="18" rx="2" />
        <rect x="14" y="3" width="7" height="18" rx="2" />
      </svg>
    </button>
  );
}
