import Document from "@tiptap/extension-document";
import { Plugin, PluginKey } from 'prosemirror-state';

export const SectionDocument = Document.extend({
  content: "heading",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('section-plugin'),
        appendTransaction: (transactions, oldState, newState) => {
          // Only proceed if there are actual changes
          if (!transactions.some(tr => tr.docChanged)) return null;

          const { doc, tr } = newState;
          const firstNode = doc.firstChild;

          // If first node is not a heading or not level 1, replace entire content with h1
          if (!firstNode || firstNode.type.name !== 'heading' || firstNode.attrs.level !== 1) {
            tr.replaceWith(0, doc.content.size, newState.schema.nodes.heading.create(
              { level: 1 },
              newState.schema.text('Untitled')
            ));
            return tr;
          }

          // If there's more than one node, remove everything after the h1
          if (doc.childCount > 1) {
            tr.delete(firstNode.nodeSize, doc.content.size);
            return tr;
          }

          return null;
        },
      }),
    ];
  },
}); 