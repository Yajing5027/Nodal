import type { JSX } from 'react';
import { MathView } from './MathView';
import { $getNodeByKey, DecoratorNode, type NodeKey, type SerializedLexicalNode } from 'lexical';
import { addExportVisitor$, addImportVisitor$, addLexicalNode$, addMdastExtension$, addSyntaxExtension$, addToMarkdownExtension$, realmPlugin, type LexicalExportVisitor, type MdastImportVisitor } from '@mdxeditor/editor';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown, mathToMarkdown, type Math as MathAst, type InlineMath } from 'mdast-util-math';

type SerializedMath = SerializedLexicalNode & { formula: string; display: boolean };

/** Markdown remains canonical; this node only supplies an editable math view. */
export class MathNode extends DecoratorNode<JSX.Element> {
  __formula: string;
  __display: boolean;
  static getType() { return 'nodal-math'; }
  static clone(node: MathNode) { return new MathNode(node.__formula, node.__display, node.__key); }
  constructor(formula = '', display = false, key?: NodeKey) {
    super(key); this.__formula = formula; this.__display = display;
  }
  static importJSON(value: SerializedMath) { return new MathNode(value.formula, value.display); }
  exportJSON(): SerializedMath { return { ...super.exportJSON(), type: 'nodal-math', version: 1, formula: this.__formula, display: this.__display }; }
  createDOM() { const element = document.createElement(this.__display ? 'div' : 'span'); element.className = this.__display ? 'editor-math-block' : 'editor-math-inline'; return element; }
  updateDOM() { return false; }
  isInline() { return !this.__display; }
  getTextContent() { return this.__display ? `$$\n${this.__formula}\n$$` : `$${this.__formula}$`; }
  setFormula(formula: string) { this.getWritable().__formula = formula; }
  decorate() {
    const key = this.getKey();
    return <MathView formula={this.__formula} display={this.__display} onSave={formula => {
      const node = $getNodeByKey(key);
      if (node instanceof MathNode) { if (formula) node.setFormula(formula); else node.remove(); }
    }} />;
  }
}


const importer: MdastImportVisitor<MathAst | InlineMath> = {
  testNode: node => node.type === 'math' || node.type === 'inlineMath',
  visitNode({ mdastNode, actions }) { actions.addAndStepInto(new MathNode(mdastNode.value, mdastNode.type === 'math')); },
};
const exporter: LexicalExportVisitor<MathNode, MathAst | InlineMath> = {
  testLexicalNode: (node): node is MathNode => node instanceof MathNode,
  visitLexicalNode({ lexicalNode, actions }) { actions.addAndStepInto(lexicalNode.__display ? 'math' : 'inlineMath', { value: lexicalNode.__formula }, false); },
};
export const mathPlugin = realmPlugin({ init(realm) {
  realm.pubIn({ [addLexicalNode$]: MathNode, [addImportVisitor$]: importer, [addExportVisitor$]: exporter,
    [addSyntaxExtension$]: math(), [addMdastExtension$]: mathFromMarkdown(), [addToMarkdownExtension$]: mathToMarkdown() });
} });
