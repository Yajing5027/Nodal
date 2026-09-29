import { useState } from 'react';
import type { RecallAnchor, KnowledgeNode, RetrievalTarget } from '../../domain/types';
import { MarkdownReading } from '../nodes/MarkdownReading';
import { targetAnchors } from '../review/recallAnchors';
import { splitNotePanels } from '../../domain/notePanels';
import { sectionLabel } from '../../domain/sectionTransclusion';

export interface CardDocumentProps {
  guidanceNodeId?: string;
  markdown?: string;
  target?: RetrievalTarget;
  anchors?: RecallAnchor[];
  preview?: boolean;
  revealed?: boolean;
  revealOverrides?: Record<string, boolean>;
  onRevealChange?: (id: string, visible: boolean) => void;
  transcludeGetNode?: (id: string) => KnowledgeNode | undefined;
}

/** The same document projection is used by note preview, card practice and review. */
export function CardDocument({
  guidanceNodeId,
  markdown,
  target,
  anchors,
  preview = false,
  revealed = false,
  revealOverrides = {},
  onRevealChange,
  transcludeGetNode,
}: CardDocumentProps) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);

  const marks = anchors ?? (target ? targetAnchors(target) : []);
  const display = { preview, revealed, revealOverrides, onRevealChange, transcludeGetNode };
  const cue = target && (target.presentation === 'question' || target.presentation === 'hidden') && target.promptMarkdown.trim()
    ? <section className="card-recall-cue" aria-label="Recall question"><MarkdownReading>{target.promptMarkdown}</MarkdownReading></section> : null;

  if (markdown !== undefined && (!target || marks.length > 0)) {
    return <>{cue}<MarkdownReading guidanceNodeId={guidanceNodeId} interactivePanels maskAnchors={marks} {...display}>{markdown}</MarkdownReading></>;
  }

  if (!target) return <MarkdownReading>{markdown ?? ''}</MarkdownReading>;

  if (marks.length && markdown === undefined) {
    const snapshot = marks.reduce((result, anchor) => ({
      markdown: result.markdown + (anchor.blockMarkdown ?? anchor.context) + '\n\n',
      anchors: [...result.anchors, { ...anchor, blockStart: result.markdown.length }],
    }), { markdown: '', anchors: [] as RecallAnchor[] });
    return (
      <div className="card-snapshot">
        <MarkdownReading>{target.promptMarkdown}</MarkdownReading>
        <MarkdownReading maskAnchors={snapshot.anchors} {...display}>{snapshot.markdown}</MarkdownReading>
      </div>
    );
  }

  const visible = preview || (revealOverrides.answer ?? revealed);

  // Helper to render source section reference upon reveal
  const renderSourceReference = () => {
    if (!visible || !markdown) return null;
    if (target.sectionId) {
      const sections = splitNotePanels(markdown);
      const section = sections.find((s) => s.id === target.sectionId);
      if (section) {
        return (
          <details className="source-section-reference" style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '10px' }} open>
            <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Source: {sectionLabel(section.markdown, 0)}
            </summary>
            <div style={{ marginTop: '8px', padding: '10px', background: 'var(--surface-secondary, rgba(0,0,0,0.02))', borderRadius: '6px' }}>
              <MarkdownReading transcludeGetNode={transcludeGetNode}>{section.markdown}</MarkdownReading>
            </div>
          </details>
        );
      }
      return (
        <p className="card-stale" style={{ marginTop: '12px', fontSize: '12px', color: 'var(--danger)' }}>
          Source section "{target.sectionId}" is no longer found in the current note.
        </p>
      );
    }
    return (
      <details className="source-section-reference" style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
        <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>
          View full note source
        </summary>
        <div style={{ marginTop: '8px', padding: '10px', background: 'var(--surface-secondary, rgba(0,0,0,0.02))', borderRadius: '6px' }}>
          <MarkdownReading transcludeGetNode={transcludeGetNode}>{markdown}</MarkdownReading>
        </div>
      </details>
    );
  };

  // 1. Multiple Choice Question
  if (target.practiceType === 'choice' && target.options && target.options.length > 0) {
    return (
      <div className="card-question practice-choice-card">
        <MarkdownReading>{target.promptMarkdown}</MarkdownReading>

        <div
          className="practice-choice-options"
          role="radiogroup"
          aria-label="Choices"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '16px 0' }}
        >
          {target.options.map((opt) => {
            const isSelected = selectedOptionId === opt.id;
            const isCorrect = opt.id === target.correctOptionId;
            let optBorder = '1px solid var(--border)';
            let optBg = 'var(--surface)';

            if (visible) {
              if (isCorrect) {
                optBorder = '1px solid #2e663a';
                optBg = 'rgba(46, 102, 58, 0.1)';
              } else if (isSelected) {
                optBorder = '1px solid #b8332a';
                optBg = 'rgba(184, 51, 42, 0.1)';
              }
            } else if (isSelected) {
              optBorder = '1px solid var(--accent)';
              optBg = 'var(--surface-hover)';
            }

            return (
              <button
                key={opt.id}
                type="button"
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: optBorder,
                  background: optBg,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
                onClick={() => setSelectedOptionId(opt.id)}
                aria-checked={isSelected}
                role="radio"
              >
                <div>
                  <strong style={{ marginRight: '8px' }}>{opt.id.toUpperCase()}.</strong>
                  <span>{opt.textMarkdown}</span>
                </div>
                {visible && isCorrect && <span style={{ color: '#2e663a', fontWeight: 600, fontSize: '12px' }}>✓ Correct</span>}
                {visible && isSelected && !isCorrect && <span style={{ color: '#b8332a', fontWeight: 600, fontSize: '12px' }}>✗ Selected</span>}
              </button>
            );
          })}
        </div>

        {visible ? (
          <section className="card-answer">
            {!preview && onRevealChange && (
              <button className="block-hide-control" onClick={() => onRevealChange('answer', false)}>
                Hide answer
              </button>
            )}
            {target.explanationMarkdown && (
              <div className="card-explanation" style={{ marginTop: '10px', padding: '10px 14px', background: 'var(--surface-secondary, rgba(0,0,0,0.03))', borderRadius: '8px' }}>
                <strong style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>Explanation:</strong>
                <MarkdownReading>{target.explanationMarkdown}</MarkdownReading>
              </div>
            )}
            {renderSourceReference()}
          </section>
        ) : (
          onRevealChange && (
            <button className="whole-block-blank" onClick={() => onRevealChange('answer', true)}>
              Reveal answer & explanation
            </button>
          )
        )}
      </div>
    );
  }

  // 2. Cloze Question (with masked blanks)
  if (target.practiceType === 'cloze' && target.blanks && target.blanks.length > 0) {
    const blankMap = new Map(target.blanks.map((b) => [b.id, b.answerMarkdown]));

    // Build prompt with blanks filled or masked
    const renderedCloze = target.promptMarkdown.replace(/\{\{blank:([a-zA-Z0-9_-]+)\}\}/g, (_, blankId) => {
      const answer = blankMap.get(blankId) ?? '___';
      if (visible) {
        return `**[${answer}]**`;
      }
      return ` __[____]__ `;
    });

    return (
      <div className="card-question practice-cloze-card">
        <MarkdownReading>{renderedCloze}</MarkdownReading>

        {visible ? (
          <section className="card-answer" style={{ marginTop: '14px' }}>
            {!preview && onRevealChange && (
              <button className="block-hide-control" onClick={() => onRevealChange('answer', false)}>
                Hide answer
              </button>
            )}
            <div style={{ marginTop: '8px' }}>
              <strong style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Answers:</strong>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {target.blanks.map((b) => (
                  <li key={b.id}>
                    <strong>{b.id}:</strong> {b.answerMarkdown}
                  </li>
                ))}
              </ul>
            </div>
            {target.explanationMarkdown && (
              <div className="card-explanation" style={{ marginTop: '10px', padding: '10px 14px', background: 'var(--surface-secondary, rgba(0,0,0,0.03))', borderRadius: '8px' }}>
                <strong style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>Explanation:</strong>
                <MarkdownReading>{target.explanationMarkdown}</MarkdownReading>
              </div>
            )}
            {renderSourceReference()}
          </section>
        ) : (
          onRevealChange && (
            <button className="whole-block-blank" style={{ marginTop: '14px' }} onClick={() => onRevealChange('answer', true)}>
              Reveal blanks & explanation
            </button>
          )
        )}
      </div>
    );
  }

  // 3. Standard Flashcard or generic question
  return (
    <div className="card-question">
      <MarkdownReading>{target.promptMarkdown}</MarkdownReading>
      {visible ? (
        <section className="card-answer">
          {!preview && onRevealChange && (
            <button className="block-hide-control" onClick={() => onRevealChange('answer', false)}>
              Hide answer
            </button>
          )}
          <MarkdownReading>
            {target.expectedEvidenceMarkdown || markdown || 'Check your answer against the source.'}
          </MarkdownReading>
          {renderSourceReference()}
        </section>
      ) : (
        onRevealChange && (
          <button className="whole-block-blank" onClick={() => onRevealChange('answer', true)}>
            Reveal answer
          </button>
        )
      )}
    </div>
  );
}
