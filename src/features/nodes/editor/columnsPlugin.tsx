import type { JSX } from 'react';
import { ColumnsView } from './ColumnsView';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  DecoratorNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical';
import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  realmPlugin,
  type LexicalExportVisitor,
  type MdastImportVisitor,
} from '@mdxeditor/editor';
import { createColumnsMarkdown, transformColumnsMdast } from '../../../domain/columnLayout';

type SerializedColumns = SerializedLexicalNode & { columns: string[] };

export class ColumnsNode extends DecoratorNode<JSX.Element> {
  __columns: string[];

  static getType() {
    return 'nodal-columns';
  }

  static clone(node: ColumnsNode) {
    return new ColumnsNode([...node.__columns], node.__key);
  }

  constructor(columns: string[] = ['', ''], key?: NodeKey) {
    super(key);
    this.__columns = columns.length >= 2 ? columns : ['', ''];
  }

  static importJSON(value: SerializedColumns) {
    return new ColumnsNode(value.columns);
  }

  exportJSON(): SerializedColumns {
    return {
      ...super.exportJSON(),
      type: 'nodal-columns',
      version: 1,
      columns: this.__columns,
    };
  }

  createDOM() {
    const element = document.createElement('div');
    element.className = 'editor-columns-wrapper';
    return element;
  }

  updateDOM() {
    return false;
  }

  isInline() {
    return false;
  }

  getTextContent() {
    return createColumnsMarkdown(this.__columns);
  }

  setColumns(columns: string[]) {
    this.getWritable().__columns = columns;
  }

  decorate() {
    const key = this.getKey();
    return (
      <ColumnsView
        columns={this.__columns}
        onChange={newCols => {
          const node = $getNodeByKey(key);
          if (node instanceof ColumnsNode) {
            node.setColumns(newCols);
          }
        }}
        onRemove={() => {
          const node = $getNodeByKey(key);
          if (node instanceof ColumnsNode) {
            node.remove();
          }
        }}
        onUnwrap={unwrapped => {
          const node = $getNodeByKey(key);
          if (node instanceof ColumnsNode) {
            const p = $createParagraphNode();
            p.append($createTextNode(unwrapped));
            node.replace(p);
          }
        }}
      />
    );
  }
}

const importer: MdastImportVisitor<any> = {
  testNode: (node: any) => (node as any).type === 'nodalColumns',
  visitNode({ mdastNode, actions }) {
    actions.addAndStepInto(new ColumnsNode(mdastNode.columns));
  },
};

const exporter: LexicalExportVisitor<ColumnsNode, any> = {
  testLexicalNode: (node): node is ColumnsNode => node instanceof ColumnsNode,
  visitLexicalNode({ lexicalNode, actions }) {
    const html = createColumnsMarkdown(lexicalNode.__columns);
    actions.addAndStepInto('html', { value: html }, false);
  },
};

export const columnsPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addLexicalNode$]: ColumnsNode,
      [addImportVisitor$]: importer,
      [addExportVisitor$]: exporter,
      [addMdastExtension$]: { transforms: [transformColumnsMdast] },
    });
  },
});
