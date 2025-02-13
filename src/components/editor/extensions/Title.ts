import Document from "@tiptap/extension-document";
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from 'prosemirror-state';

export const Title = Document.extend({
  content: "heading block*",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('title-plugin'),
        appendTransaction: (transactions, oldState, newState) => {
          // Only proceed if there are actual changes
          if (!transactions.some(tr => tr.docChanged)) return null;

          const { doc, tr } = newState;
          const firstNode = doc.firstChild;

          // If first node is not a heading or not level 1
          if (!firstNode || firstNode.type.name !== 'heading' || firstNode.attrs.level !== 1) {
            const transaction = tr.insert(0, newState.schema.nodes.heading.create({ level: 1 }));
            return transaction;
          }

          return null;
        },
      }),
    ];
  },
});


