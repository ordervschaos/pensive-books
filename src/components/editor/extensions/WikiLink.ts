import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, unknown>;
  onNavigate?: (pageTitle: string, bookId: number) => void;
  bookId?: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (pageTitle: string) => ReturnType;
      unsetWikiLink: () => ReturnType;
    };
  }
}

export const WikiLink = Mark.create<WikiLinkOptions>({
  name: 'wikiLink',

  addOptions() {
    return {
      HTMLAttributes: {},
      onNavigate: undefined,
      bookId: undefined,
    };
  },

  addAttributes() {
    return {
      pageTitle: {
        default: null,
        parseHTML: element => element.getAttribute('data-page-title'),
        renderHTML: attributes => {
          if (!attributes.pageTitle) {
            return {};
          }
          return {
            'data-page-title': attributes.pageTitle,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-wiki-link]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-wiki-link': '',
        class: 'wiki-link cursor-pointer text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted',
      }),
      0,
    ];
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: new PluginKey('wikiLink'),
        props: {
          // Handle wiki-link syntax [[page title]]
          handleTextInput(view, from, to, text) {
            // Check if we just completed a wiki-link pattern
            const { state } = view;
            const textBefore = state.doc.textBetween(Math.max(0, from - 100), from, '\n', '\n');

            // Check if we just typed the closing ]]
            if (text === ']' && textBefore.endsWith(']')) {
              // Find the opening [[
              const match = /\[\[([^\]]+)\]\]$/.exec(textBefore + text);
              if (match) {
                const pageTitle = match[1].trim();
                const matchStart = from - match[0].length + 1;
                const matchEnd = from + 1;

                // Create transaction to replace [[page title]] with wiki-link mark
                const tr = state.tr.delete(matchStart, matchEnd);
                tr.insertText(pageTitle, matchStart);
                tr.addMark(
                  matchStart,
                  matchStart + pageTitle.length,
                  state.schema.marks.wikiLink.create({ pageTitle })
                );

                view.dispatch(tr);
                return true;
              }
            }

            return false;
          },

          // Handle clicks on wiki-links
          handleClick(view, pos, event) {
            // First check: did we actually click on a wiki link DOM element?
            const target = event.target as HTMLElement;
            const wikiLinkElement = target.closest('[data-wiki-link]');

            if (!wikiLinkElement) {
              // Not clicking on a wiki link element, don't handle
              return false;
            }

            // Second check: is there a wiki link mark at this position in the document?
            const { doc } = view.state;
            const $pos = doc.resolve(pos);
            const marks = $pos.marks();
            const wikiLinkMark = marks.find(mark => mark.type.name === 'wikiLink');

            if (wikiLinkMark && options.onNavigate && options.bookId) {
              event.preventDefault();
              const pageTitle = wikiLinkMark.attrs.pageTitle;
              options.onNavigate(pageTitle, options.bookId);
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setWikiLink: (pageTitle: string) => ({ commands }) => {
        return commands.setMark(this.name, { pageTitle });
      },
      unsetWikiLink: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      },
    };
  },
});
