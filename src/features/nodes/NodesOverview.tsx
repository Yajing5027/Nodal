// ============================================================
// NodesOverview — Cross-note Nodes mastery view
// ============================================================
// Unified view grouped by Note:
// - Group header displays Note total mastery score and cards count
// - Below lists each section with its title, excerpt, and section score
// - Cumulative mastery score: initial = 1st review, subsequent = round(0.6 * now + 0.4 * old)
// - Unrated / no cards displays neutral state ("—" / "Unrated"), not 0%
// ============================================================

import { useState, useMemo, useEffect } from 'react';
import { liveQuery } from 'dexie';
import { useApp } from '../../app/useApp';
import { db } from '../../db/database';
import { splitNotePanels } from '../../domain/notePanels';
import { sectionLabel } from '../../domain/sectionTransclusion';
import {
  computeNodeMastery,
  computeNoteMastery,
  buildCardCumulativeScoresMap,
  type NodeMasteryScore,
} from '../../domain/nodeScoring';
import type { RetrievalTarget, ReviewEvent, KnowledgeNode } from '../../domain/types';
import { ChoiceSelect } from '../../components/ui/ChoiceSelect';
import { KnowledgeCard } from '../cards/KnowledgeCard';

interface SectionItem {
  id: string;
  title: string;
  parentId?: string;
  excerpt: string;
  mastery: NodeMasteryScore;
}

interface NoteGroupItem {
  node: KnowledgeNode;
  mastery: NodeMasteryScore;
  sections: SectionItem[];
}

export function NodesOverview() {
  const { nodes, tags, openNodeSection, openNode, selectedNodeId, setSelectedNodeId } = useApp();
  const [targets, setTargets] = useState<RetrievalTarget[]>([]);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [query, setQuery] = useState(() => sessionStorage.getItem('nodal:nodes-query') || '');
  const [sortField, setSortField] = useState<'score' | 'title'>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleQueryChange = (val: string) => {
    setQuery(val);
    sessionStorage.setItem('nodal:nodes-query', val);
  };

  const handleSortDirToggle = () => {
    setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
  };

  useEffect(() => {
    const sub = liveQuery(async () => {
      const [t, e] = await Promise.all([
        db.retrievalTargets.toArray(),
        db.reviewEvents.toArray(),
      ]);
      return { t, e };
    }).subscribe({
      next: ({ t, e }) => {
        setTargets(t);
        setEvents(e);
      },
      error: err => console.error('Error loading targets and events in NodesOverview', err),
    });
    return () => sub.unsubscribe();
  }, []);

  // Precompute cumulative scores for all cards (0-100) using round(0.6 * now + 0.4 * old)
  const cardScores = useMemo(() => buildCardCumulativeScoresMap(events), [events]);

  // Build note groups with their sections
  const noteGroups = useMemo((): NoteGroupItem[] => {
    const groups: NoteGroupItem[] = [];

    for (const node of nodes) {
      const panels = splitNotePanels(node.contentMarkdown || '');
      const effectivePanels =
        panels.length > 0
          ? panels
          : [{ id: 'main', markdown: node.contentMarkdown || '', hidden: false, start: 0, end: (node.contentMarkdown || '').length }];

      const noteMastery = computeNoteMastery(node.id, targets, cardScores);

      const sections: SectionItem[] = effectivePanels.map((panel, index) => {
        const secMastery = computeNodeMastery(node.id, panel.id, targets, cardScores);
        const ownTitle = panel.title?.trim() || sectionLabel(panel.markdown, index);

        // Excerpt
        const cleanLines = panel.markdown
          .replace(/^#+\s+.*$/gm, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/<[^>]+>/g, '')
          .trim()
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean);
        const excerpt = cleanLines[0] || 'No content preview';

        return {
          id: panel.id,
          title: ownTitle,
          parentId: panel.parentId ?? undefined,
          excerpt: excerpt.length > 130 ? excerpt.slice(0, 130) + '…' : excerpt,
          mastery: secMastery,
        };
      });

      groups.push({
        node,
        mastery: noteMastery,
        sections,
      });
    }

    return groups;
  }, [nodes, targets, cardScores]);

  // Filter and sort groups
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();

    return noteGroups
      .filter(group => {
        if (!q) return true;
        const nodeMatch = (group.node.title || '').toLowerCase().includes(q);
        if (nodeMatch) return true;
        return group.sections.some(s => s.title.toLowerCase().includes(q) || s.excerpt.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === 'score') {
          const scoreA = a.mastery.score;
          const scoreB = b.mastery.score;
          if (scoreA === null && scoreB === null) diff = (a.node.title || '').localeCompare(b.node.title || '');
          else if (scoreA === null) return 1;
          else if (scoreB === null) return -1;
          else diff = scoreA - scoreB;
        } else {
          diff = (a.node.title || '').localeCompare(b.node.title || '');
        }
        return sortDir === 'asc' ? diff : -diff;
      });
  }, [noteGroups, query, sortField, sortDir]);

  // Stats
  const totalNotes = noteGroups.length;
  const totalSections = noteGroups.reduce((acc, g) => acc + g.sections.length, 0);
  const ratedNotes = noteGroups.filter(g => g.mastery.score !== null).length;

  return (
    <div className="card-document-container" style={{ padding: '24px', maxWidth: 'min(1120px, 100%)', margin: '0 auto' }}>
      <header style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 6px' }}>Nodes</h1>
        <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '14px' }}>
          Knowledge mastery overview grouped by note ({totalNotes} notes, {totalSections} sections · {ratedNotes} rated).
        </p>
      </header>

      {/* Search and Sort Toolbar */}
      <div
        className="cards-tools"
        style={{
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: '20px',
        }}
      >
        <input
          type="search"
          aria-label="Filter notes and sections"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ChoiceSelect
            aria-label="Sort notes by"
            value={sortField}
            onChange={e => setSortField(e.target.value as typeof sortField)}
          >
            <option value="score">Note Score</option>
            <option value="title">Note Title</option>
          </ChoiceSelect>
          <button
            type="button"
            className="ghost"
            onClick={handleSortDirToggle}
            aria-label={`Sort direction: ${sortDir === 'asc' ? 'Ascending' : 'Descending'}`}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            style={{ minWidth: 32, padding: '6px 8px' }}
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Note Groups List */}
      {filteredGroups.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
          No notes match the current filter.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {filteredGroups.map(group => {
            const noteScore = group.mastery.score;
            const noteScoreBg =
              noteScore === null
                ? 'var(--surface-secondary)'
                : noteScore >= 80
                ? 'rgba(52, 168, 83, 0.12)'
                : noteScore >= 50
                ? 'rgba(249, 171, 0, 0.15)'
                : 'rgba(234, 67, 53, 0.12)';
            const noteScoreColor =
              noteScore === null
                ? 'var(--text-muted)'
                : noteScore >= 80
                ? 'var(--color-success, #1e8e3e)'
                : noteScore >= 50
                ? 'var(--color-warning, #e37400)'
                : 'var(--color-danger, #d93025)';

            const noteTags = tags.filter(t => (group.node.tagIds || []).includes(t.id));

            return (
              <div
                key={group.node.id}
                className="note-mastery-group"
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  background: 'var(--surface)',
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                }}
              >
                {/* Note Group Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    background: 'var(--surface-secondary, rgba(0,0,0,0.02))',
                    borderBottom: '1px solid var(--border)',
                    gap: '16px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => openNode(group.node.id)}
                      style={{
                        padding: 0,
                        fontSize: '16px',
                        fontWeight: 700,
                        color: 'var(--text)',
                        textAlign: 'left',
                        textDecoration: 'none',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {group.node.title || 'Untitled note'}
                    </button>
                    {noteTags.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {noteTags.map(t => (
                          <span
                            key={t.id}
                            style={{
                              fontSize: '11px',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              background: 'var(--surface-tertiary, rgba(0,0,0,0.05))',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            #{t.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      · {group.sections.length} {group.sections.length === 1 ? 'section' : 'sections'}
                    </span>
                  </div>

                  {/* Note Total Score + Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {group.mastery.summary}
                    </span>
                    <span
                      className="note-mastery-score-badge"
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: '6px',
                        background: noteScoreBg,
                        color: noteScoreColor,
                        minWidth: '60px',
                        textAlign: 'center',
                        display: 'inline-block',
                      }}
                    >
                      {noteScore !== null ? `${noteScore}%` : '— Unrated'}
                    </span>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => openNode(group.node.id)}
                      style={{ fontSize: '12px', padding: '3px 8px' }}
                    >
                      Open Note →
                    </button>
                  </div>
                </div>

                {/* Sections List */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {group.sections.map((section, idx) => {
                    const secScore = section.mastery.score;
                    const secScoreBg =
                      secScore === null
                        ? 'transparent'
                        : secScore >= 80
                        ? 'rgba(52, 168, 83, 0.1)'
                        : secScore >= 50
                        ? 'rgba(249, 171, 0, 0.12)'
                        : 'rgba(234, 67, 53, 0.1)';
                    const secScoreColor =
                      secScore === null
                        ? 'var(--text-muted)'
                        : secScore >= 80
                        ? 'var(--color-success, #1e8e3e)'
                        : secScore >= 50
                        ? 'var(--color-warning, #e37400)'
                        : 'var(--color-danger, #d93025)';

                    return (
                      <div
                        key={section.id}
                        className="section-mastery-row"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 18px',
                          borderTop: idx > 0 ? '1px solid var(--border-light, #eee)' : undefined,
                          paddingLeft: section.parentId ? '36px' : '18px',
                          background: 'var(--surface-primary)',
                          transition: 'background 0.15s ease',
                          gap: '14px',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                            {section.parentId && (
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  padding: '1px 4px',
                                  borderRadius: '3px',
                                  background: 'var(--surface-secondary, rgba(0,0,0,0.06))',
                                  color: 'var(--text-muted)',
                                }}
                              >
                                Sub
                              </span>
                            )}
                            <strong style={{ fontSize: '13.5px', color: 'var(--text)' }}>
                              {section.title}
                            </strong>
                          </div>
                          <div
                            style={{
                              fontSize: '12px',
                              color: 'var(--text-secondary)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {section.excerpt}
                          </div>
                        </div>

                        {/* Section Score + Action */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {section.mastery.summary}
                          </span>
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: secScoreBg,
                              color: secScoreColor,
                              minWidth: '48px',
                              textAlign: 'center',
                              display: 'inline-block',
                            }}
                          >
                            {secScore !== null ? `${secScore}%` : '—'}
                          </span>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => openNodeSection(group.node.id, section.id)}
                            style={{ fontSize: '11.5px', padding: '2px 6px', color: 'var(--accent)' }}
                          >
                            Open →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedNodeId && (
        <KnowledgeCard
          key={selectedNodeId}
          nodeId={selectedNodeId}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}
