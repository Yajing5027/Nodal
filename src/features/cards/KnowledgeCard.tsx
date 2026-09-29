import { ChoiceSelect } from '../../components/ui/ChoiceSelect';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { liveQuery } from 'dexie';
import type { RetrievalTarget } from '../../domain/types';
import { useApp } from '../../app/useApp';
import { getRetrievalTargetsForSource } from '../../repositories/reviewRepository';
import { resolveAnchor, targetAnchors, recallPrompt } from '../review/recallAnchors';
import { WordRecallPicker } from '../review/WordRecallPicker';
import { SelectionRecall, type RecallCreated } from '../review/SelectionRecall';
import { RecallTargetsPanel } from '../review/RecallTargetsPanel';
import { PlanAssignmentControl } from '../review/PlanAssignmentControl';
import { ReviewHistory } from '../review/ReviewHistory';
import { CardDocument } from './CardDocument';
import { CardSurface } from './CardSurface';
import { NoteExport } from '../export/NoteExport';
import { AIGuidance } from '../nodes/AIGuidance';
import { splitNotePanels } from '../../domain/notePanels';
import { sectionLabel } from '../../domain/sectionTransclusion';
import { mergeRecallAnchors } from './recallMarks';
import { PracticeImportDialog } from './PracticeImportDialog';
import { generatePracticePrompt } from '../../domain/practiceProtocol';
import { reviewRetrievalTarget } from '../../repositories/reviewRepository';
import type { ReviewResult } from '../../domain/types';
import { newId } from '../../domain/id';
import { getFeatureFlags } from '../../domain/featureFlags';
import { TargetNodeLinksEditor } from '../review/TargetNodeLinksEditor';

const Editor = lazy(() => import('../nodes/NodeInspector').then(module => ({ default: module.NodeInspector })));
type Mode = 'preview' | 'edit' | 'practice' | 'mark';

export function KnowledgeCard({ nodeId, target: initialTarget, onClose }: { nodeId?: string; target?: RetrievalTarget; onClose: () => void }) {
  const { getNode, tags, startReview, pendingSectionId, consumePendingSection } = useApp();
  const node = nodeId ? getNode(nodeId) : undefined;
  const [mode, setMode] = useState<Mode>(node && !node.contentMarkdown.trim() ? 'edit' : 'preview');
  const [items, setItems] = useState<Awaited<ReturnType<typeof getRetrievalTargetsForSource>>>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(initialTarget?.id ?? '');
  const [revealed, setRevealed] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState(false);
  const [sectionFilter, setSectionFilter] = useState('all');

  const [practiceView, setPracticeView] = useState<'overview' | 'question'>(initialTarget ? 'question' : 'overview');
  const [selectedPracticeIds, setSelectedPracticeIds] = useState<Set<string>>(new Set());
  const [questionCount, setQuestionCount] = useState('');
  const [countError, setCountError] = useState('');
  const [ratingStatus, setRatingStatus] = useState('');
  const [ratingBusy, setRatingBusy] = useState(false);

  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!nodeId) return;
    const subscription = liveQuery(() => getRetrievalTargetsForSource('node', nodeId)).subscribe({
      next: value => {
        setItems(value);
        setSelectedId(current => current || value[0]?.target.id || '');
        setLoaded(true);
        setError('');
      },
      error: () => setError('Could not load recall marks.'),
    });
    return () => subscription.unsubscribe();
  }, [nodeId]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('.formula-overlay')) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key === 'Tab' && dialog.current?.contains(event.target as Node)) {
        const controls = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, summary, [tabindex="0"], [contenteditable="true"]')].filter(element => element.getClientRects().length);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);

  useEffect(() => {
    if (!pendingSectionId || !nodeId) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const el = dialog.current?.querySelector<HTMLElement>(`[data-note-panel-id="${window.CSS?.escape(pendingSectionId) ?? pendingSectionId}"]`);
      if (el) {
        clearInterval(timer);
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('section-focus-flash');
        window.setTimeout(() => el.classList.remove('section-focus-flash'), 1800);
        consumePendingSection();
      } else if (tries > 30) {
        clearInterval(timer);
        dialog.current?.querySelector('.knowledge-card-body')?.scrollTo({ top: 0 });
        consumePendingSection();
      }
    }, 50);
    return () => clearInterval(timer);
  }, [pendingSectionId, nodeId, consumePendingSection]);

  const sections = useMemo(() => node ? splitNotePanels(node.contentMarkdown) : [], [node]);
  const fallbackTarget = !nodeId || !loaded ? initialTarget : undefined;
  const allTargets = items.length ? items.map(item => item.target) : fallbackTarget ? [fallbackTarget] : [];

  const filteredTargets = useMemo(() => {
    if (mode !== 'practice' || sectionFilter === 'all') return allTargets;
    if (sectionFilter === 'global') return allTargets.filter(t => !t.sectionId);
    return allTargets.filter(t => t.sectionId === sectionFilter || t.anchor?.panelId === sectionFilter);
  }, [allTargets, mode, sectionFilter]);

  const selected = filteredTargets.find(item => item.id === selectedId) ?? (fallbackTarget?.id === selectedId ? fallbackTarget : filteredTargets[0]);

  const hasHiddenPanels = !!node && splitNotePanels(node.contentMarkdown).some(panel => panel.hidden);
  const allAnchors = allTargets.flatMap(targetAnchors);
  const resolve = (anchors: ReturnType<typeof targetAnchors>) => node ? anchors.flatMap(anchor => { const resolved = resolveAnchor(node.contentMarkdown, anchor); return resolved ? [resolved] : []; }) : anchors;
  const previewAnchors = mergeRecallAnchors(resolve(allAnchors));
  const selectedAnchors = selected ? resolve(targetAnchors(selected)) : [];
  const stale = !!selected && selectedAnchors.length !== targetAnchors(selected).length;
  const activeTarget = selected ? { ...selected, ...(selectedAnchors.length ? { anchor: selectedAnchors[0], anchors: selectedAnchors } : {}) } : undefined;

  const changeMode = (value: Mode) => {
    setMode(value);
    setRevealed(false);
    setOverrides({});
    setRatingStatus('');
    if (value === 'practice') {
      if (!initialTarget) {
        setPracticeView('overview');
      }
      setSelectedPracticeIds(new Set());
    }
  };
  const onCreated: RecallCreated = (ids, practice) => {
    setSelectedId(ids[0]);
    if (practice) {
      setMode('practice');
      setPracticeView('question');
      setRevealed(false);
      setOverrides({});
      setRatingStatus('');
    }
  };
  const selectPrompt = (id: string) => { setSelectedId(id); setRevealed(false); setOverrides({}); setRatingStatus(''); };
  const selectedIndex = filteredTargets.findIndex(target => target.id === (selected?.id ?? selectedId));
  const reviewIds = mode === 'preview' ? allTargets.map(target => target.id) : selected ? [selected.id] : [];

  const getSectionTitle = (secId?: string | null) => {
    if (!secId) return 'Global (whole note)';
    const idx = sections.findIndex(s => s.id === secId);
    if (idx >= 0) return sectionLabel(sections[idx].markdown, idx);
    return secId;
  };

  const handleQuestionCountChange = (val: string) => {
    setQuestionCount(val);
    if (!val.trim()) {
      setCountError('');
      return;
    }
    const n = Number(val);
    if (!Number.isInteger(n) || n <= 0) {
      setCountError('Must be a positive whole number (e.g. 5) or left empty.');
    } else {
      setCountError('');
    }
  };

  const handleCopyPrompt = async () => {
    if (!node) return;
    if (countError) return;
    const countNum = questionCount.trim() ? Number(questionCount) : undefined;
    if (countNum !== undefined && (!Number.isInteger(countNum) || countNum <= 0)) {
      setCountError('Must be a positive whole number (e.g. 5) or left empty.');
      return;
    }
    const promptText = generatePracticePrompt(node, sections, {
      questionCount: countNum,
      targetSectionId: sectionFilter !== 'all' ? sectionFilter : null,
    });
    try {
      await navigator.clipboard.writeText(promptText);
      setCopyStatus(true);
      setTimeout(() => setCopyStatus(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleExportQuestions = (includeAnswers = true) => {
    const targetsToExport = selectedPracticeIds.size > 0
      ? filteredTargets.filter(t => selectedPracticeIds.has(t.id))
      : filteredTargets;
    if (!targetsToExport.length) return;

    let text = `# Practice Questions: ${node?.title || 'Recall Questions'}\n\n`;
    targetsToExport.forEach((t, i) => {
      text += `### Question ${i + 1} [${(t.practiceType || 'Question').toUpperCase()}]\n\n`;
      text += `${t.promptMarkdown}\n\n`;
      if (t.practiceType === 'choice' && t.options) {
        t.options.forEach(opt => {
          text += `- ${opt.id.toUpperCase()}: ${opt.textMarkdown}\n`;
        });
        text += '\n';
      }
      if (includeAnswers) {
        text += `**Answer:**\n`;
        if (t.practiceType === 'choice') {
          text += `Correct: ${t.correctOptionId || t.correctOptionIds?.join(', ') || 'N/A'}\n\n`;
        } else if (t.practiceType === 'cloze' && t.blanks) {
          text += t.blanks.map(b => `${b.id}: ${b.answerMarkdown}`).join('\n') + '\n\n';
        } else {
          text += `${t.expectedEvidenceMarkdown}\n\n`;
        }
        if (t.explanationMarkdown) {
          text += `**Explanation:** ${t.explanationMarkdown}\n\n`;
        }
      }
      text += '---\n\n';
    });

    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(node?.title || 'practice').replace(/[\\/:*?"<>|]/g, '_')}-questions.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleStartReview = () => {
    const idsToReview = selectedPracticeIds.size > 0
      ? Array.from(selectedPracticeIds)
      : filteredTargets.map(t => t.id);
    if (idsToReview.length > 0) {
      startReview(idsToReview);
    }
  };

  const toggleSelectQuestion = (id: string) => {
    setSelectedPracticeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedPracticeIds.size === filteredTargets.length) {
      setSelectedPracticeIds(new Set());
    } else {
      setSelectedPracticeIds(new Set(filteredTargets.map(t => t.id)));
    }
  };

  const handlePracticeRating = async (rating: ReviewResult) => {
    if (!selected || ratingBusy) return;
    setRatingBusy(true);
    try {
      const event = await reviewRetrievalTarget({
        targetId: selected.id,
        result: rating,
        responseTimeMs: 1000,
        sessionId: newId(),
        eventId: newId(),
        answerRevealedAt: Date.now(),
      });
      const label = rating === 'missed' ? 'Forgot' : rating === 'partial' ? 'Partial' : 'Recalled';
      setRatingStatus(`Recorded: ${label}. Next review scheduled for ${new Date(event.resultingState.dueAt).toLocaleDateString('en-US')}.`);
    } catch (err) {
      setRatingStatus(err instanceof Error ? err.message : 'Could not save review rating.');
    } finally {
      setRatingBusy(false);
    }
  };

  const cardContent = (
    <CardDocument
      guidanceNodeId={mode === 'preview' ? node?.id : undefined}
      markdown={node?.contentMarkdown}
      target={mode === 'preview' && node ? undefined : activeTarget}
      anchors={mode === 'preview' ? previewAnchors : selectedAnchors}
      preview={mode === 'preview'}
      revealed={revealed}
      revealOverrides={overrides}
      onRevealChange={(id, visible) => setOverrides(current => ({ ...current, [id]: visible }))}
      transcludeGetNode={getNode}
    />
  );

  return createPortal(
    <div className="knowledge-card-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Knowledge card" className="knowledge-card-modal">
        <CardSurface>
          <header className="knowledge-card-header">
            <span>{(nodeId || node) ? 'Note' : 'Recall card'}</span>
            <div className="card-mode-tabs" role="group" aria-label="Card mode">
              <button aria-pressed={mode === 'preview'} onClick={() => changeMode('preview')}>Preview</button>
              {node && <button aria-pressed={mode === 'edit'} onClick={() => changeMode('edit')}>Edit</button>}
              <button aria-pressed={mode === 'practice'} onClick={() => changeMode('practice')}>Practice</button>
            </div>
            <button className="card-close" aria-label="Close card" onClick={onClose}>×</button>
          </header>

          {error && <p role="alert">{error}</p>}

          <div className={`knowledge-card-body mode-${mode}`}>
            {mode === 'edit' && node ? (
              <Suspense fallback={<p>Opening editor…</p>}>
                <Editor context="card" nodeId={node.id} onRecallCreated={onCreated} />
              </Suspense>
            ) : (
              <div className="card-document-container">
                {node && (
                  <div className="card-tag-line">
                    {tags.filter(tag => node.tagIds.includes(tag.id)).map(tag => <span key={tag.id}>{tag.name}</span>)}
                  </div>
                )}
                <h1>{node?.title || 'Recall card'}</h1>
                {node?.overview && (
                  <div
                    className="note-overview-block"
                    style={{
                      margin: '12px 0 16px',
                      padding: '10px 14px',
                      background: 'var(--surface-secondary)',
                      borderLeft: '3px solid var(--accent)',
                      borderRadius: '6px',
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '4px' }}>Overview</div>
                    <div>{node.overview}</div>
                  </div>
                )}
                {node && mode === 'preview' && (
                  <div className="card-plan-line">
                    <PlanAssignmentControl subjectType="node" subjectId={node.id} />
                    <NoteExport node={node} />
                  </div>
                )}

                {node && mode === 'preview' && (
                  <details className="note-guidance-disclosure">
                    <summary>Guidance{node.aiGuidance?.note ? ' · saved' : ''}</summary>
                    <AIGuidance nodeId={node.id} />
                  </details>
                )}

                {mode === 'mark' && node ? (
                  <WordRecallPicker sourceId={node.id} markdown={node.contentMarkdown} onCreated={onCreated} onClose={() => changeMode('preview')} />
                ) : mode === 'practice' ? (
                  <div className="practice-workspace">
                    {/* Practice Overview View */}
                    {practiceView === 'overview' ? (
                      <div className="practice-overview">
                        <div className="practice-overview-header">
                          <div className="practice-scope-chips" role="group" aria-label="Practice section scopes">
                            <button
                              type="button"
                              className={`practice-scope-chip${sectionFilter === 'all' ? ' is-active' : ''}`}
                              onClick={() => setSectionFilter('all')}
                            >
                              All <span className="practice-scope-chip-count">{allTargets.length}</span>
                            </button>
                            {allTargets.some(t => !t.sectionId) && (
                              <button
                                type="button"
                                className={`practice-scope-chip${sectionFilter === 'global' ? ' is-active' : ''}`}
                                onClick={() => setSectionFilter('global')}
                              >
                                Global <span className="practice-scope-chip-count">{allTargets.filter(t => !t.sectionId).length}</span>
                              </button>
                            )}
                            {sections.map((s, idx) => {
                              const secCount = allTargets.filter(t => t.sectionId === s.id || t.anchor?.panelId === s.id).length;
                              const label = sectionLabel(s.markdown, idx);
                              return (
                                <button
                                  key={s.id}
                                  type="button"
                                  className={`practice-scope-chip${sectionFilter === s.id ? ' is-active' : ''}`}
                                  onClick={() => setSectionFilter(s.id)}
                                >
                                  {label} <span className="practice-scope-chip-count">{secCount}</span>
                                </button>
                              );
                            })}
                          </div>

                          <div className="practice-overview-actions">
                            <div className="copy-prompt-group" style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '2px 4px 2px 8px',
                              background: 'var(--surface-secondary)',
                              border: '1px solid var(--border)',
                              borderRadius: '7px',
                            }}>
                              <label htmlFor="practice-q-count" style={{ fontSize: '12px', color: 'var(--text-secondary)', userSelect: 'none' }}>Questions:</label>
                              <input
                                id="practice-q-count"
                                type="number"
                                min="1"
                                step="1"
                                placeholder="All"
                                value={questionCount}
                                onChange={e => handleQuestionCountChange(e.target.value)}
                                style={{ width: '52px', padding: '2px 6px', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface)' }}
                              />
                              <button
                                type="button"
                                className="ghost"
                                style={{ fontSize: '12px', padding: '4px 10px', height: '28px', border: 'none' }}
                                onClick={handleCopyPrompt}
                                title="Copy prompt for generating practice items"
                              >
                                {copyStatus ? '✓ Copied Prompt!' : 'Copy Prompt'}
                              </button>
                            </div>
                            <button
                              type="button"
                              className="ghost"
                              style={{ fontSize: '12px', padding: '5px 10px' }}
                              onClick={() => setImportDialogOpen(true)}
                              title="Import practice JSON"
                            >
                              Import JSON
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              style={{ fontSize: '12px', padding: '5px 10px' }}
                              disabled={filteredTargets.length === 0}
                              onClick={() => handleExportQuestions(true)}
                              title="Export selected questions"
                            >
                              Export questions{selectedPracticeIds.size > 0 ? ` (${selectedPracticeIds.size})` : ''}
                            </button>
                            <button
                              type="button"
                              className="primary"
                              style={{ fontSize: '12px', padding: '5px 14px' }}
                              disabled={filteredTargets.length === 0}
                              onClick={handleStartReview}
                              title="Start full spaced repetition review"
                            >
                              Start Review{selectedPracticeIds.size > 0 ? ` (${selectedPracticeIds.size})` : ` (${filteredTargets.length})`}
                            </button>
                          </div>
                        </div>

                        {countError && (
                          <div style={{ color: 'var(--danger)', fontSize: '12px', padding: '4px 0' }} role="alert">
                            {countError}
                          </div>
                        )}

                        {filteredTargets.length === 0 ? (
                          <div className="practice-empty-state" style={{ padding: '36px 20px', textAlign: 'center', background: 'var(--surface-secondary)', borderRadius: '12px', border: '1px dashed var(--border)', margin: '16px 0' }}>
                            <h3 style={{ margin: '0 0 8px', fontSize: '17px', fontWeight: 600 }}>No practice questions yet</h3>
                            <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '13px', maxWidth: '420px', marginLeft: 'auto', marginRight: 'auto' }}>
                              Generate flashcards, multiple-choice questions, and clozes from your note using AI, or create clozes directly.
                            </p>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                              {node && (
                                <div className="copy-prompt-group" style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  padding: '2px 4px 2px 8px',
                                  background: 'var(--surface)',
                                  border: '1px solid var(--border)',
                                  borderRadius: '7px',
                                }}>
                                  <label htmlFor="practice-q-count-empty" style={{ fontSize: '12px', color: 'var(--text-secondary)', userSelect: 'none' }}>Questions:</label>
                                  <input
                                    id="practice-q-count-empty"
                                    type="number"
                                    min="1"
                                    step="1"
                                    placeholder="All"
                                    value={questionCount}
                                    onChange={e => handleQuestionCountChange(e.target.value)}
                                    style={{ width: '52px', padding: '2px 6px', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface-secondary)' }}
                                  />
                                  <button type="button" className="ghost" style={{ fontSize: '12px', padding: '4px 10px', height: '28px', border: 'none' }} onClick={handleCopyPrompt}>
                                    {copyStatus ? '✓ Copied Prompt!' : 'Copy Prompt'}
                                  </button>
                                </div>
                              )}
                              {node && (
                                <button type="button" className="primary" onClick={() => setImportDialogOpen(true)}>
                                  Import practice JSON
                                </button>
                              )}
                              {node && getFeatureFlags().enableClozeTools && (
                                <button type="button" className="ghost" onClick={() => changeMode('mark')}>
                                  Make cloze
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="practice-questions-tree">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 12px' }}>
                              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                {filteredTargets.length} {filteredTargets.length === 1 ? 'question' : 'questions'}
                              </span>
                              <button
                                type="button"
                                className="ghost"
                                style={{ fontSize: '12px', padding: '3px 8px' }}
                                onClick={toggleSelectAll}
                              >
                                {selectedPracticeIds.size === filteredTargets.length ? 'Deselect all' : 'Select all'}
                              </button>
                            </div>

                            {/* Group by sections */}
                            {(() => {
                              const globalItems = filteredTargets.filter(t => !t.sectionId);
                              const groups: Array<{ id: string; title: string; count: number; items: typeof filteredTargets }> = [];
                              if (globalItems.length > 0 && sectionFilter === 'all') {
                                groups.push({ id: '__global__', title: 'Global', count: globalItems.length, items: globalItems });
                              }
                              sections.forEach((s, idx) => {
                                const secItems = filteredTargets.filter(t => t.sectionId === s.id || t.anchor?.panelId === s.id);
                                if (sectionFilter === 'all' || sectionFilter === s.id) {
                                  groups.push({
                                    id: s.id,
                                    title: sectionLabel(s.markdown, idx),
                                    count: secItems.length,
                                    items: secItems,
                                  });
                                }
                              });

                              return groups.map(g => (
                                <section key={g.id} className="practice-section-group">
                                  <header className="practice-section-header">
                                    <h3>{g.title} {g.count}</h3>
                                  </header>
                                  <div className="practice-section-questions">
                                    {g.items.map(t => {
                                      const isSelected = selectedPracticeIds.has(t.id);
                                      return (
                                        <div
                                          key={t.id}
                                          className={`practice-question-item${isSelected ? ' is-selected' : ''}`}
                                          onClick={() => {
                                            setSelectedId(t.id);
                                            setPracticeView('question');
                                            setRevealed(false);
                                            setOverrides({});
                                            setRatingStatus('');
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={e => {
                                              e.stopPropagation();
                                              toggleSelectQuestion(t.id);
                                            }}
                                            onClick={e => e.stopPropagation()}
                                            aria-label={`Select question: ${recallPrompt(t).slice(0, 40)}`}
                                          />
                                          <span className="practice-question-type-badge">
                                            {t.practiceType || 'prompt'}
                                          </span>
                                          <span className="practice-question-stem">
                                            {recallPrompt(t)}
                                          </span>
                                          <span style={{ fontSize: '12px', color: 'var(--accent)', flexShrink: 0 }}>
                                            Open →
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </section>
                              ));
                            })()}
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Practice Question View */
                      <div className="practice-question-view">
                        <div className="practice-nav-bar">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              setPracticeView('overview');
                              setRatingStatus('');
                            }}
                          >
                            ← Back to questions overview
                          </button>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '13px', fontWeight: 550, color: 'var(--text-secondary)' }}>
                              {getSectionTitle(selected?.sectionId)} · Question {selectedIndex + 1} of {filteredTargets.length}
                            </span>
                            {filteredTargets.length > 1 && (
                              <div className="practice-prompt-navigation" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                  type="button"
                                  aria-label="Previous prompt"
                                  disabled={selectedIndex <= 0}
                                  onClick={() => selectPrompt(filteredTargets[selectedIndex - 1].id)}
                                >
                                  ‹
                                </button>
                                <ChoiceSelect
                                  aria-label="Practice prompt"
                                  value={selected?.id ?? ''}
                                  onChange={e => selectPrompt(e.target.value)}
                                >
                                  {filteredTargets.map((t, idx) => (
                                    <option key={t.id} value={t.id}>
                                      {idx + 1}. {recallPrompt(t).slice(0, 60)}
                                    </option>
                                  ))}
                                </ChoiceSelect>
                                <button
                                  type="button"
                                  aria-label="Next prompt"
                                  disabled={selectedIndex < 0 || selectedIndex >= filteredTargets.length - 1}
                                  onClick={() => selectPrompt(filteredTargets[selectedIndex + 1].id)}
                                >
                                  ›
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {stale ? (
                          <p className="card-stale">This selection has changed. Make a new selection in the updated note.</p>
                        ) : (
                          <>
                            {selected && <TargetNodeLinksEditor target={selected} />}
                            {cardContent}
                          </>
                        )}

                        {/* Formal Review Rating in Practice */}
                        {revealed && selected && (
                          <div className="practice-rating-bar">
                            <div>
                              <strong>Rate your recall:</strong>
                              <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                Records formal review event and updates FSRS memory state.
                              </span>
                            </div>
                            <div className="practice-rating-buttons">
                              <button
                                type="button"
                                disabled={ratingBusy}
                                onClick={() => handlePracticeRating('missed')}
                              >
                                Forgot
                              </button>
                              <button
                                type="button"
                                disabled={ratingBusy}
                                onClick={() => handlePracticeRating('partial')}
                              >
                                Partial
                              </button>
                              <button
                                type="button"
                                className="primary"
                                disabled={ratingBusy}
                                onClick={() => handlePracticeRating('recalled')}
                              >
                                Recalled
                              </button>
                            </div>
                          </div>
                        )}
                        {ratingStatus && (
                          <p style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '8px', fontWeight: 500 }} role="status">
                            {ratingStatus}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {stale ? (
                      <p className="card-stale">This selection has changed. Make a new selection in the updated note.</p>
                    ) : mode === 'preview' && node ? (
                      <SelectionRecall sourceId={node.id} onCreated={onCreated}>{cardContent}</SelectionRecall>
                    ) : (
                      cardContent
                    )}

                    {mode === 'preview' && node && (
                      <details className="note-disclosure">
                        <summary>Recall prompts · {items.length}</summary>
                        <RecallTargetsPanel nodeId={node.id} />
                      </details>
                    )}

                    {!node && selected && (
                      <NoteExport node={{ id: selected.id, title: 'Recall card', contentMarkdown: `${selected.promptMarkdown}\n\n${selected.expectedEvidenceMarkdown}`, tagIds: [], assetIds: [], createdAt: selected.createdAt, updatedAt: selected.updatedAt }} />
                    )}

                    {mode === 'preview' && !node && selected && <ReviewHistory targetId={selected.id} />}
                  </>
                )}
              </div>
            )}
          </div>

          {mode !== 'mark' && (
            <footer className="knowledge-card-footer">
              <span>
                {mode === 'practice'
                  ? 'Practice · not graded'
                  : allTargets.length > 0
                    ? `${allTargets.length} ${allTargets.length === 1 ? 'prompt' : 'prompts'}`
                    : ''}
              </span>
              <div>
                {mode === 'preview' && node && <button onClick={() => changeMode('mark')}>Make cloze</button>}
                {((mode === 'practice' && selected) || hasHiddenPanels) && !stale && (
                  <button onClick={() => { setRevealed(value => !value); setOverrides({}); }}>
                    {revealed ? 'Hide all' : 'Reveal all'}
                  </button>
                )}
                {mode === 'edit' ? (
                  <button className="primary" onClick={() => changeMode('preview')}>Done</button>
                ) : reviewIds.length > 0 && (
                  <button className="primary" onClick={() => startReview(reviewIds)}>
                    {mode === 'preview' ? `Review note · ${reviewIds.length}` : `Review (${reviewIds.length})`}
                  </button>
                )}
              </div>
            </footer>
          )}
        </CardSurface>
      </div>

      {node && (
        <PracticeImportDialog
          open={importDialogOpen}
          node={node}
          sections={sections}
          onClose={() => setImportDialogOpen(false)}
          onImportSuccess={(ids) => {
            setSelectedId(ids[0]);
            changeMode('practice');
          }}
        />
      )}
    </div>,
    document.body
  );
}
