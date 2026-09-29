// ============================================================
// CardLibrary — Recall cards with Agenda / Date view (Annotation 5)
// Groups cards by real dueAt (Overdue, Today, Tomorrow, Upcoming, New)
// with Note > Section breadcrumbs and sort toggles.
// ============================================================
import { useEffect, useState, useMemo, useCallback } from 'react';
import { liveQuery } from 'dexie';
import { useApp } from '../../app/useApp';
import { getReviewQueue, type ReviewQueueItem } from '../../repositories/reviewRepository';
import { CardRow } from '../cards/CardRow';
import { KnowledgeCard } from '../cards/KnowledgeCard';
import { recallPrompt } from './recallAnchors';
import { splitNotePanels } from '../../domain/notePanels';
import { sectionLabel } from '../../domain/sectionTransclusion';
import { ChoiceSelect } from '../../components/ui/ChoiceSelect';

interface DateGroup {
  id: string;
  label: string;
  sublabel?: string;
  items: ReviewQueueItem[];
}

export function CardLibrary() {
  const { startReview, setActiveView, getNode } = useApp();
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [selected, setSelected] = useState<ReviewQueueItem | null>(null);
  const [query, setQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'overdue' | 'today' | 'upcoming' | 'new'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'name'>(() => {
    return (localStorage.getItem('nodal:recall-sort-by') as any) || 'date';
  });
  const [viewMode, setViewMode] = useState<'agenda' | 'list'>(() => {
    return (localStorage.getItem('nodal:recall-view-mode') as any) || 'agenda';
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [nowTs, setNowTs] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const subscription = liveQuery(() => getReviewQueue(Date.now(), undefined, true)).subscribe({
      next: value => {
        setItems(value);
        setLoading(false);
        setError('');
        setNowTs(Date.now());
      },
      error: () => {
        setError('Could not load prompts. Please reopen.');
        setLoading(false);
      },
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSortChange = (next: 'date' | 'name') => {
    setSortBy(next);
    localStorage.setItem('nodal:recall-sort-by', next);
  };

  const handleViewModeChange = (mode: 'agenda' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('nodal:recall-view-mode', mode);
  };

  const personalItems = useMemo(() => items.filter(item => !item.target.exampleSetId), [items]);
  const dueItems = useMemo(() => personalItems.filter(item => item.state.dueAt <= nowTs), [personalItems, nowTs]);
  const dueCount = dueItems.length;

  // Resolve source note and section path
  const getSourcePath = useCallback((item: ReviewQueueItem): string => {
    if (item.target.sourceType === 'node') {
      const node = getNode(item.target.sourceId);
      const noteTitle = node?.title || item.sourceTitle || 'Untitled note';
      if (item.target.sectionId && node?.contentMarkdown) {
        const panels = splitNotePanels(node.contentMarkdown);
        const pIndex = panels.findIndex(p => p.id === item.target.sectionId);
        if (pIndex >= 0) {
          const sTitle = sectionLabel(panels[pIndex].markdown, pIndex);
          return `${noteTitle} > ${sTitle}`;
        }
      }
      return noteTitle;
    }
    return item.sourceTitle || 'Card';
  }, [getNode]);

  // Group items by date (Agenda model)
  const dateGroups = useMemo((): DateGroup[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfToday = today.getTime();
    const startOfTomorrow = startOfToday + 86400000;
    const startOfTwoDays = startOfTomorrow + 86400000;

    const overdue: ReviewQueueItem[] = [];
    const todayItems: ReviewQueueItem[] = [];
    const tomorrowItems: ReviewQueueItem[] = [];
    const futureByDate = new Map<string, ReviewQueueItem[]>();
    const newItems: ReviewQueueItem[] = [];

    for (const item of personalItems) {
      if (item.state.learningState === 'new' || !item.state.dueAt) {
        newItems.push(item);
      } else if (item.state.dueAt < startOfToday) {
        overdue.push(item);
      } else if (item.state.dueAt < startOfTomorrow) {
        todayItems.push(item);
      } else if (item.state.dueAt < startOfTwoDays) {
        tomorrowItems.push(item);
      } else {
        const d = new Date(item.state.dueAt);
        const key = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        const list = futureByDate.get(key) ?? [];
        list.push(item);
        futureByDate.set(key, list);
      }
    }

    const sortGroupItems = (list: ReviewQueueItem[]) => {
      return [...list].sort((a, b) => {
        if (sortBy === 'name') {
          return recallPrompt(a.target).localeCompare(recallPrompt(b.target));
        }
        return a.state.dueAt - b.state.dueAt || recallPrompt(a.target).localeCompare(recallPrompt(b.target));
      });
    };

    const groups: DateGroup[] = [];

    if (overdue.length > 0) {
      groups.push({
        id: 'overdue',
        label: 'Overdue',
        sublabel: `${overdue.length} cards requiring immediate review`,
        items: sortGroupItems(overdue),
      });
    }

    groups.push({
      id: 'today',
      label: `Today · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
      sublabel: `${todayItems.length} cards scheduled for today`,
      items: sortGroupItems(todayItems),
    });

    if (tomorrowItems.length > 0) {
      groups.push({
        id: 'tomorrow',
        label: `Tomorrow · ${new Date(startOfTomorrow).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
        sublabel: `${tomorrowItems.length} cards`,
        items: sortGroupItems(tomorrowItems),
      });
    }

    // Sorted future dates
    for (const [dateStr, list] of futureByDate.entries()) {
      groups.push({
        id: `date-${dateStr}`,
        label: dateStr,
        sublabel: `${list.length} cards`,
        items: sortGroupItems(list),
      });
    }

    if (newItems.length > 0) {
      groups.push({
        id: 'new',
        label: 'New & Unscheduled',
        sublabel: `${newItems.length} newly created cards not yet scheduled`,
        items: sortGroupItems(newItems),
      });
    }

    return groups;
  }, [personalItems, sortBy]);

  // Filter groups according to query and date filter chip
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();

    return dateGroups
      .map(group => {
        if (dateFilter === 'overdue' && group.id !== 'overdue') return null;
        if (dateFilter === 'today' && group.id !== 'today') return null;
        if (dateFilter === 'new' && group.id !== 'new') return null;
        if (dateFilter === 'upcoming' && ['overdue', 'today', 'new'].includes(group.id)) return null;

        const matchingItems = group.items.filter(item => {
          if (!q) return true;
          const prompt = recallPrompt(item.target).toLowerCase();
          const source = getSourcePath(item).toLowerCase();
          return prompt.includes(q) || source.includes(q);
        });

        if (matchingItems.length === 0) return null;
        return { ...group, items: matchingItems };
      })
      .filter((g): g is DateGroup => Boolean(g));
  }, [dateGroups, query, dateFilter, getSourcePath]);

  // Flattened items for list view
  const flatItems = useMemo(() => {
    const all: ReviewQueueItem[] = [];
    for (const g of filteredGroups) {
      all.push(...g.items);
    }
    if (sortBy === 'name') {
      return all.sort((a, b) => recallPrompt(a.target).localeCompare(recallPrompt(b.target)));
    }
    return all.sort((a, b) => (a.state.dueAt || 0) - (b.state.dueAt || 0));
  }, [filteredGroups, sortBy]);

  const totalFilteredCount = flatItems.length;

  return (
    <main className="cards-page">
      <header className="cards-heading">
        <div>
          <h1>Recall cards</h1>
          <p className="cards-subhead">
            {dueCount > 0
              ? `${dueCount} ${dueCount === 1 ? 'prompt' : 'prompts'} due for review today`
              : 'All prompts up to date'}
          </p>
        </div>
        <div className="cards-actions">
          <button aria-label="Review plan settings" onClick={() => setActiveView('plans')}>
            Review plans ⚙
          </button>
          {dueCount > 0 ? (
            <button className="primary" onClick={() => startReview()}>
              Start today’s review ({dueCount}) →
            </button>
          ) : (
            <button
              className="ghost"
              disabled
              style={{
                opacity: 0.85,
                cursor: 'default',
                background: 'var(--surface-tertiary)',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                fontWeight: 500,
                fontSize: '13px',
                padding: '6px 14px',
                borderRadius: '7px',
              }}
              title="No prompts currently due for review"
            >
              All caught up
            </button>
          )}
        </div>
      </header>

      {/* Date filter chips */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <button
          type="button"
          className={dateFilter === 'all' ? 'primary' : 'ghost'}
          onClick={() => setDateFilter('all')}
          style={{ fontSize: '12px', padding: '4px 10px' }}
        >
          All dates ({personalItems.length})
        </button>
        <button
          type="button"
          className={dateFilter === 'overdue' ? 'ghost is-selected' : 'ghost'}
          onClick={() => setDateFilter('overdue')}
          style={{
            fontSize: '12px',
            padding: '4px 10px',
            ...(dateFilter === 'overdue' ? {
              background: 'rgba(184, 134, 11, 0.14)',
              color: 'var(--warning, #b8860b)',
              border: '1px solid var(--warning, #b8860b)',
              fontWeight: 600,
            } : {}),
          }}
        >
          Overdue ({dateGroups.find(g => g.id === 'overdue')?.items.length || 0})
        </button>
        <button
          type="button"
          className={dateFilter === 'today' ? 'primary' : 'ghost'}
          onClick={() => setDateFilter('today')}
          style={{ fontSize: '12px', padding: '4px 10px' }}
        >
          Today ({dateGroups.find(g => g.id === 'today')?.items.length || 0})
        </button>
        <button
          type="button"
          className={dateFilter === 'upcoming' ? 'primary' : 'ghost'}
          onClick={() => setDateFilter('upcoming')}
          style={{ fontSize: '12px', padding: '4px 10px' }}
        >
          Upcoming (
          {personalItems.filter(i => {
            const startOfTomorrow = new Date().setHours(0, 0, 0, 0) + 86400000;
            return i.state.dueAt >= startOfTomorrow && i.state.learningState !== 'new';
          }).length}
          )
        </button>
        <button
          type="button"
          className={dateFilter === 'new' ? 'primary' : 'ghost'}
          onClick={() => setDateFilter('new')}
          style={{ fontSize: '12px', padding: '4px 10px' }}
        >
          New / Unscheduled ({dateGroups.find(g => g.id === 'new')?.items.length || 0})
        </button>
      </div>

      {/* Toolbar: search, sort, and view mode */}
      <div className="cards-tools" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth: 200 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)', pointerEvents: 'none' }}>
            <path d="M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0" />
          </svg>
          <input
            aria-label="Search prompts"
            value={query}
            onChange={event => setQuery(event.target.value)}
            style={{ width: '100%', paddingLeft: '32px' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ChoiceSelect
            aria-label="Sort cards by"
            value={sortBy}
            onChange={e => handleSortChange(e.target.value as 'date' | 'name')}
          >
            <option value="date">Date</option>
            <option value="name">Name</option>
          </ChoiceSelect>

          <div
            style={{
              display: 'inline-flex',
              background: 'var(--surface-tertiary)',
              padding: '2px',
              borderRadius: '7px',
              border: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              className="ghost"
              onClick={() => handleViewModeChange('agenda')}
              style={{
                fontSize: '12px',
                padding: '3px 12px',
                borderRadius: '5px',
                border: 'none',
                background: viewMode === 'agenda' ? 'var(--surface)' : 'transparent',
                fontWeight: viewMode === 'agenda' ? 600 : 400,
                color: viewMode === 'agenda' ? 'var(--text)' : 'var(--text-muted)',
                boxShadow: viewMode === 'agenda' ? 'var(--shadow-sm)' : 'none',
                cursor: 'pointer',
              }}
              title="Group by date agenda"
            >
              Agenda
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => handleViewModeChange('list')}
              style={{
                fontSize: '12px',
                padding: '3px 12px',
                borderRadius: '5px',
                border: 'none',
                background: viewMode === 'list' ? 'var(--surface)' : 'transparent',
                fontWeight: viewMode === 'list' ? 600 : 400,
                color: viewMode === 'list' ? 'var(--text)' : 'var(--text-muted)',
                boxShadow: viewMode === 'list' ? 'var(--shadow-sm)' : 'none',
                cursor: 'pointer',
              }}
              title="Flat list"
            >
              List
            </button>
          </div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      {loading ? (
        <p className="empty-state">Loading prompts…</p>
      ) : totalFilteredCount > 0 ? (
        viewMode === 'agenda' ? (
          <div className="cards-agenda-view" style={{ display: 'flex', flexDirection: 'column', gap: '28px', marginTop: '16px' }}>
            {filteredGroups.map(group => {
              const isOverdueGroup = group.id === 'overdue';
              return (
                <section key={group.id} className="recall-date-group">
                  <header
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      padding: '8px 0',
                      borderBottom: isOverdueGroup
                        ? '2px solid var(--warning, #b8860b)'
                        : '1px solid var(--border)',
                      marginBottom: '12px',
                    }}
                  >
                    <div>
                      <h2
                        style={{
                          fontSize: '16px',
                          fontWeight: 700,
                          margin: 0,
                          color: isOverdueGroup ? 'var(--warning, #b8860b)' : 'var(--text)',
                        }}
                      >
                        {group.label}
                      </h2>
                      {group.sublabel && (
                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                          {group.sublabel}
                        </p>
                      )}
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {group.items.length} {group.items.length === 1 ? 'card' : 'cards'}
                    </span>
                  </header>

                  <div className="card-row-list">
                    {group.items.map(item => {
                      const isDue = item.state.dueAt <= nowTs;
                      const sourcePath = getSourcePath(item);
                      const dueText =
                        item.state.learningState === 'new'
                          ? 'New'
                          : isDue
                          ? 'Due now'
                          : `Due ${new Date(item.state.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

                      return (
                        <article className="recall-library-row" key={item.target.id}>
                          <CardRow
                            title={sourcePath}
                            excerpt={recallPrompt(item.target)}
                            label={`Preview prompt: ${recallPrompt(item.target)}`}
                            onOpen={() => setSelected(item)}
                            tags={
                              <>
                                <span>
                                  {item.target.presentation === 'cloze'
                                    ? 'Cloze'
                                    : item.target.presentation === 'hidden'
                                    ? 'Hidden blocks'
                                    : 'Question'}
                                </span>
                                <span>
                                  {item.state.reviewCount} {item.state.reviewCount === 1 ? 'review' : 'reviews'}
                                </span>
                                <span
                                  style={{
                                    fontWeight: isDue || isOverdueGroup ? 600 : undefined,
                                    color: isOverdueGroup ? 'var(--warning, #b8860b)' : undefined,
                                  }}
                                >
                                  {dueText}
                                </span>
                              </>
                            }
                          />
                          <footer>
                            {isDue ? (
                              <button onClick={() => startReview(undefined, { focusTargetId: item.target.id })}>
                                Review →
                              </button>
                            ) : (
                              <button onClick={() => startReview([item.target.id])}>Practice →</button>
                            )}
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="card-row-list" style={{ marginTop: '16px' }}>
            {flatItems.map(item => {
              const isDue = item.state.dueAt <= nowTs;
              const sourcePath = getSourcePath(item);
              const dueText =
                item.state.learningState === 'new'
                  ? 'New'
                  : isDue
                  ? 'Due now'
                  : `Due ${new Date(item.state.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

              return (
                <article className="recall-library-row" key={item.target.id}>
                  <CardRow
                    title={sourcePath}
                    excerpt={recallPrompt(item.target)}
                    label={`Preview prompt: ${recallPrompt(item.target)}`}
                    onOpen={() => setSelected(item)}
                    tags={
                      <>
                        <span>
                          {item.target.presentation === 'cloze'
                            ? 'Cloze'
                            : item.target.presentation === 'hidden'
                            ? 'Hidden blocks'
                            : 'Question'}
                        </span>
                        <span>
                          {item.state.reviewCount} {item.state.reviewCount === 1 ? 'review' : 'reviews'}
                        </span>
                        <span style={{ fontWeight: isDue ? 600 : undefined }}>{dueText}</span>
                      </>
                    }
                  />
                  <footer>
                    {isDue ? (
                      <button onClick={() => startReview(undefined, { focusTargetId: item.target.id })}>
                        Review →
                      </button>
                    ) : (
                      <button onClick={() => startReview([item.target.id])}>Practice →</button>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        )
      ) : (
        <div className="cards-empty">
          <span>⌑</span>
          <h2>{personalItems.length ? 'No matching prompts found' : 'Keep what is worth remembering'}</h2>
          <p>
            {personalItems.length
              ? 'Try changing your search query or date filter.'
              : 'Select text in a note or write a question. Your recall prompts live here.'}
          </p>
          {!personalItems.length && <button onClick={() => setActiveView('nodes')}>Create from a note →</button>}
        </div>
      )}

      {selected && (
        <KnowledgeCard
          key={selected.target.id}
          nodeId={selected.target.sourceType === 'node' ? selected.target.sourceId : undefined}
          target={selected.target}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}
