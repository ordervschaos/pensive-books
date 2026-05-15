import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface PageLinkOptions {
  HTMLAttributes: Record<string, any>;
  onPageLinkClick?: (pageId: string, bookId: string) => void;
}

export const PageLink = Mark.create<PageLinkOptions>({
  name: 'pageLink',

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'page-link inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer transition-colors text-sm font-medium no-underline',
      },
      onPageLinkClick: undefined,
    };
  },

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: element => element.getAttribute('data-page-id'),
        renderHTML: attributes => {
          if (!attributes.pageId) return {};
          return { 'data-page-id': attributes.pageId };
        },
      },
      title: {
        default: null,
        parseHTML: element => element.getAttribute('data-title'),
        renderHTML: attributes => {
          if (!attributes.title) return {};
          return { 'data-title': attributes.title };
        },
      },
      bookId: {
        default: null,
        parseHTML: element => element.getAttribute('data-book-id'),
        renderHTML: attributes => {
          if (!attributes.bookId) return {};
          return { 'data-book-id': attributes.bookId };
        },
      },
      broken: {
        default: false,
        parseHTML: element => element.getAttribute('data-broken') === 'true',
        renderHTML: attributes => {
          if (!attributes.broken) return {};
          return { 'data-broken': 'true' };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-page-link]',
        getAttrs: dom => {
          const element = dom as HTMLElement;
          return {
            pageId: element.getAttribute('data-page-id'),
            title: element.getAttribute('data-title'),
            bookId: element.getAttribute('data-book-id'),
            broken: element.getAttribute('data-broken') === 'true',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const baseClass = 'page-link inline-flex items-center gap-1 px-2 py-0.5 rounded-full cursor-pointer transition-colors text-sm font-medium no-underline';

    let attrs;

    // Different styling for broken vs active links
    if (HTMLAttributes.broken) {
      attrs = mergeAttributes(
        {
          class: `${baseClass} bg-destructive/10 text-destructive/50 line-through hover:bg-destructive/15`,
          title: 'This page no longer exists',
        },
        { 'data-page-link': 'true' },
        HTMLAttributes
      );
    } else {
      attrs = mergeAttributes(
        this.options.HTMLAttributes,
        { 'data-page-link': 'true' },
        HTMLAttributes
      );
    }

    return ['span', attrs, 0];
  },

  addProseMirrorPlugins() {
    const { onPageLinkClick } = this.options;

    return [
      new Plugin({
        key: new PluginKey('pageLinkClick'),
        props: {
          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            const linkElement = target.closest('[data-page-link]');

            if (linkElement) {
              const pageId = linkElement.getAttribute('data-page-id');
              const bookId = linkElement.getAttribute('data-book-id');
              const broken = linkElement.getAttribute('data-broken') === 'true';

              // Don't navigate if broken link
              if (broken) {
                event.preventDefault();
                return true;
              }

              if (pageId && bookId && onPageLinkClick) {
                event.preventDefault();
                onPageLinkClick(pageId, bookId);
                return true;
              }
            }

            return false;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setPageLink: (attributes: { pageId: string; title: string; bookId: string }) => ({ commands }: { commands: any }) => {
        return commands.setMark(this.name, attributes);
      },
      unsetPageLink: () => ({ commands }: { commands: any }) => {
        return commands.unsetMark(this.name);
      },
    } as any;
  },

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        // Could be used to trigger page link search
        return false;
      },
    };
  },
});
