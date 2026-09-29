import { useCellValue, usePublisher } from '@mdxeditor/gurx';
import { convertSelectionToNode$, currentBlockType$ } from '@mdxeditor/editor';
import { $createParagraphNode } from 'lexical';
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text';

/** Keep the writing styles visible instead of hiding them in a block-type dropdown. */
export function TextStyleButtons() {
  const current = useCellValue(currentBlockType$);
  const convert = usePublisher(convertSelectionToNode$);
  return <span className="text-style-buttons" role="group" aria-label="Text style">
    {['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'quote'].map(style => <button key={style} type="button" title={style === 'paragraph' ? 'Paragraph' : style === 'quote' ? 'Quote' : `Heading ${style.slice(1)}`} aria-label={style === 'paragraph' ? 'Paragraph' : style === 'quote' ? 'Quote' : `Heading ${style.slice(1)}`} aria-pressed={current === style} onMouseDown={event => event.preventDefault()} onClick={() => convert(() => style === 'paragraph' ? $createParagraphNode() : style === 'quote' ? $createQuoteNode() : $createHeadingNode(style as HeadingTagType))}>{style === 'paragraph' ? 'P' : style === 'quote' ? '“' : style.toUpperCase()}</button>)}
  </span>;
}
