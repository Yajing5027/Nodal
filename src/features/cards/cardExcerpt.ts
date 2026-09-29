import { projectExcerpt } from '../../domain/contentProjection';
import type { KnowledgeNode } from '../../domain/types';

export function cardExcerpt(
  nodeOrMarkdown: KnowledgeNode | string,
  getNode?: (id: string) => KnowledgeNode | undefined,
): string {
  return projectExcerpt(nodeOrMarkdown, getNode, 220);
}
