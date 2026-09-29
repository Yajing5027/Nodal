import type { RecallAnchor } from '../../domain/types';
import { MarkdownReading } from '../nodes/MarkdownReading';
import { documentBlocks } from './recallAnchors';

/** Whole-block masking never flattens Markdown into plain text. */
export function BlockReviewDocument({ markdown, anchors, revealed, onReveal }: { markdown: string; anchors: RecallAnchor[]; revealed: boolean; onReveal?: () => void }) {
  return <div className="block-review-document">{documentBlocks(markdown).map(block => {
    const hidden = anchors.some(anchor => anchor.blockStart === block.start);
    return <section key={block.start} className={hidden ? 'document-block recall-block' : 'document-block'}>
      {hidden && !revealed ? onReveal ? <button className="whole-block-blank" aria-label="Reveal hidden block" onClick={onReveal}>Reveal {block.kind}</button> : <div className="whole-block-blank" aria-label="Hidden block">Hidden {block.kind}</div>
        : <MarkdownReading>{block.markdown}</MarkdownReading>}
    </section>;
  })}</div>;
}
