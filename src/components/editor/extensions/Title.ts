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

          // Only insert 'Untitled' if the document is completely empty
          if (!firstNode || doc.childCount === 0) {
            console.log('Document is empty, inserting empty H1');
            const transaction = tr.insert(0, newState.schema.nodes.heading.create(
              { level: 1 },
              newState.schema.text('Untitled')
            ));
            return transaction;
          }

          return null;
        },
      }),
    ];
  },
});


