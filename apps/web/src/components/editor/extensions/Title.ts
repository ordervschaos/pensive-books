import { Document } from "@tiptap/extension-document";
import { Plugin, PluginKey } from 'prosemirror-state';

export const Title = Document.extend({
  content: "block+",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('title-plugin'),
        appendTransaction: (transactions, _oldState, newState) => {
          // Only proceed if there are actual changes
          if (!transactions.some(tr => tr.docChanged)) return null;

          const { doc, tr } = newState;
          const firstNode = doc.firstChild;

          // If document is empty, insert a heading
          if (!firstNode || doc.childCount === 0) {
            const transaction = tr.insert(0, newState.schema.nodes.heading.create(
              { level: 1 },
              newState.schema.text('Untitled')
            ));
            return transaction;
          }

          // If first node is not a heading, convert it to one
          if (firstNode.type.name !== 'heading') {
            const heading = newState.schema.nodes.heading.create(
              { level: 1 },
              firstNode.content
            );
            tr.replaceWith(0, firstNode.nodeSize, heading);
            return tr;
          }

          return null;
        },
      }),
    ];
  },
});


