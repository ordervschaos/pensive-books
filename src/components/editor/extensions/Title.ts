import Document from "@tiptap/extension-document";
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

          return null;
        },
      }),
    ];
  },
});


