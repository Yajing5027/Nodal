// ============================================================
// TagEditor — tag pills with remove buttons + add-tag input
// Tags are shared classification; creating a tag adds it globally.
// ============================================================
import { useState } from 'react';
import type { KnowledgeNode, KnowledgeTag, ID } from '../../domain/types';
import { useApp } from '../../app/useApp';
import { createTag } from '../../repositories/tagRepository';

interface TagEditorProps {
  node: KnowledgeNode;
  onTagsChange: (tagIds: ID[]) => void;
}

export function TagEditor({ node, onTagsChange }: TagEditorProps) {
  const { tags, refreshTags } = useApp();
  const [inputValue, setInputValue] = useState('');

  const nodeTags: KnowledgeTag[] = node.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is KnowledgeTag => Boolean(t));

  const handleAddTag = async () => {
    const name = inputValue.trim();
    if (!name) return;
    // Already attached to this node?
    const alreadyOnNode = nodeTags.some(
      (t) => t.name.toLowerCase() === name.toLowerCase()
    );
    if (alreadyOnNode) {
      setInputValue('');
      return;
    }
    // Find existing tag globally or create one
    const existing = tags.find(
      (t) => t.name.toLowerCase() === name.toLowerCase()
    );
    let tag = existing;
    if (!tag) {
      tag = await createTag({ name });
      refreshTags();
    }
    onTagsChange([...node.tagIds, tag.id]);
    setInputValue('');
  };

  const handleRemoveTag = (tagId: ID) => {
    onTagsChange(node.tagIds.filter((id) => id !== tagId));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        {nodeTags.map((tag) => (
          <span
            key={tag.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              fontSize: 'var(--font-xs)',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-tertiary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              whiteSpace: 'nowrap',
            }}
          >
            {tag.name}
            <button
              className="ghost"
              onClick={() => handleRemoveTag(tag.id)}
              aria-label={`Remove tag ${tag.name}`}
              style={{
                padding: 0,
                fontSize: 'var(--font-xs)',
                lineHeight: 1,
                color: 'var(--text-muted)',
                minWidth: 0,
              }}
            >
              ×
            </button>
          </span>
        ))}
        {nodeTags.length === 0 && (
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-faint)' }}>
            No tags yet
          </span>
        )}
      </div>
      <input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleAddTag();
          }
        }}
        placeholder="Add tag… (Enter to confirm)"
        style={{ fontSize: 'var(--font-sm)' }}
      />
    </div>
  );
}
