import { useEffect, useRef, useState } from 'react';
import { db } from '../../db/database';
import { useApp } from '../../app/useApp';
import { updateNode } from '../../repositories/nodeRepository';

export function AIGuidance({ nodeId, sectionId }: { nodeId: string; sectionId?: string }) {
  const { getNode } = useApp();
  const existing = getNode(nodeId)?.aiGuidance;
  const [value, setValue] = useState((sectionId ? existing?.sections[sectionId] : existing?.note) ?? '');
  const [status, setStatus] = useState('');
  const version = useRef(0);
  useEffect(() => {
    let cancelled = false;
    void db.nodes.get(nodeId).then(node => { if (!cancelled && version.current === 0) setValue((sectionId ? node?.aiGuidance?.sections[sectionId] : node?.aiGuidance?.note) ?? ''); });
    return () => { cancelled = true; };
  }, [nodeId, sectionId]);
  const save = async (text: string) => {
    setValue(text); setStatus('Saving…'); const current = ++version.current;
    try {
      await db.transaction('rw', [db.nodes, db.retrievalTargets, db.planAssignments, db.planExecutionStates, db.semesterPlans, db.meta], async () => {
        const node = await db.nodes.get(nodeId); if (!node) throw new Error('Note missing');
        const previous = node.aiGuidance ?? {note:'', sections:{}};
        await updateNode(nodeId, {aiGuidance: sectionId ? {...previous, sections:{...previous.sections, [sectionId]:text}} : {...previous, note:text}});
      });
      if (version.current === current) setStatus('Saved');
    } catch { if (version.current === current) setStatus('Could not save. Retry below.'); }
  };
  return (
    <div className="ai-guidance">
      <label>
        <span>Guidance</span>
        <textarea
          aria-label={sectionId ? 'Section Guidance' : 'Note Guidance'}
          value={value}
          onChange={event => void save(event.target.value)}
        />
      </label>
      {status ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
          <small role="status">{status}</small>
          {status.startsWith('Could not') && (
            <button type="button" className="ghost" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => void save(value)}>
              Retry save
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
