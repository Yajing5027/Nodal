import { CardDocument, type CardDocumentProps } from '../cards/CardDocument';

/** Compatibility entry point; all cards share the document renderer. */
export function RecallContent(props: CardDocumentProps) {
  return <CardDocument {...props} />;
}
