import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SlugService } from '@/utils/slugService';
import type { Editor } from '@tiptap/core';
import type { Range } from '@tiptap/core';

interface Page {
  id: string;
  title: string;
  page_index: number;
  book_id: string;
}

interface PageSuggestion extends Page {
  displayTitle: string;
}

interface PageListProps {
  items: PageSuggestion[];
  command: (item: PageSuggestion) => void;
  query: string;
  onCreateNew?: (title: string) => void;
}

interface PageListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

// The dropdown component that shows suggestions
const PageList = forwardRef<PageListRef, PageListProps>(
  ({ items, command, query, onCreateNew }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const showCreateNew = query.trim().length > 0;
    const totalItems = items.length + (showCreateNew ? 1 : 0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items, query]);

    const selectItem = (index: number) => {
      // If last item and we have a "Create new" option
      if (showCreateNew && index === items.length) {
        onCreateNew?.(query.trim());
      } else {
        const item = items[index];
        if (item) {
          command(item);
        }
      }
    };

    const upHandler = () => {
      setSelectedIndex((selectedIndex + totalItems - 1) % totalItems);
    };

    const downHandler = () => {
      setSelectedIndex((selectedIndex + 1) % totalItems);
    };

    const enterHandler = (altKey: boolean) => {
      // Alt/Option + Enter always creates new page if query exists
      if (altKey && query.trim().length > 0) {
        onCreateNew?.(query.trim());
      } else {
        selectItem(selectedIndex);
      }
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          upHandler();
          return true;
        }

        if (event.key === 'ArrowDown') {
          downHandler();
          return true;
        }

        if (event.key === 'Enter') {
          enterHandler(event.altKey || event.metaKey);
          return true;
        }

        return false;
      },
    }));

    return (
      <div className="min-w-[250px] max-h-[400px] overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
        {items.length > 0 && (
          <>
            {items.map((item, index) => (
              <button
                key={item.id}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors ${
                  index === selectedIndex ? 'bg-accent text-accent-foreground' : ''
                } ${index === 0 ? 'rounded-t-md' : ''} ${index === items.length - 1 && !showCreateNew ? 'rounded-b-md' : ''}`}
                onClick={() => selectItem(index)}
                type="button"
              >
                <div className="font-medium">{item.displayTitle}</div>
                <div className="text-xs text-muted-foreground">Page {item.page_index + 1}</div>
              </button>
            ))}
            {showCreateNew && <div className="border-t border-border" />}
          </>
        )}

        {showCreateNew && (
          <button
            className={`w-full text-left px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors rounded-b-md ${
              selectedIndex === items.length ? 'bg-accent text-accent-foreground' : ''
            }`}
            onClick={() => selectItem(items.length)}
            type="button"
          >
            <div className="font-medium text-primary">+ Create "{query}"</div>
            <div className="text-xs text-muted-foreground">Press Alt+Enter to create new page</div>
          </button>
        )}

        {!showCreateNew && items.length === 0 && (
          <div className="px-4 py-2 text-sm text-muted-foreground rounded-md">
            Start typing to search or create a page
          </div>
        )}
      </div>
    );
  }
);

PageList.displayName = 'PageList';

interface PageLinkSuggestionOptions {
  bookId: string | null;
  onNavigateToPage?: (pageId: string, bookId: string) => void;
}

export const PageLinkSuggestion = Extension.create<PageLinkSuggestionOptions>({
  name: 'pageLinkSuggestion',

  addOptions() {
    return {
      bookId: null,
      onNavigateToPage: undefined,
    };
  },

  addProseMirrorPlugins() {
    const bookId = this.options.bookId;
    const onNavigateToPage = this.options.onNavigateToPage;

    return [
      Suggestion({
        editor: this.editor,
        char: '[[',
        allowSpaces: true,

        // Custom function to find the range including closing ]]
        findSuggestionMatch: ({ $position }) => {
          const textBefore = $position.doc.textBetween(
            Math.max(0, $position.pos - 500),
            $position.pos,
            '\n',
            '\0'
          );

          // Find the last occurrence of [[
          const lastBracketPos = textBefore.lastIndexOf('[[');
          if (lastBracketPos === -1) return null;

          // Extract text from [[ to current position
          const textFromBracket = textBefore.slice(lastBracketPos + 2);

          // If user typed ]] before cursor, close the suggestion
          if (textFromBracket.includes(']]')) {
            return null; // Close the suggestion
          }

          // Check if there's a closing ]] after cursor
          const textAfter = $position.doc.textBetween(
            $position.pos,
            Math.min($position.doc.content.size, $position.pos + 500),
            '\n',
            '\0'
          );

          // Check if we're between ] and ] (cursor after first ])
          if (textFromBracket.endsWith(']') && textAfter.startsWith(']')) {
            return null; // Close the suggestion - we're in the middle of ]]
          }

          const closingBracketPos = textAfter.indexOf(']]');

          // If we have closing brackets, include text until ]]
          let query = textFromBracket;
          let rangeEnd = $position.pos;

          if (closingBracketPos !== -1) {
            const textUntilClosing = textAfter.slice(0, closingBracketPos);
            query = textFromBracket + textUntilClosing;
            rangeEnd = $position.pos + closingBracketPos + 2; // Include the ]]
          }

          return {
            range: {
              from: $position.pos - textFromBracket.length - 2, // Include [[
              to: rangeEnd,
            },
            query: query,
            text: '[[' + query + (closingBracketPos !== -1 ? ']]' : ''),
          };
        },

        items: async ({ query }): Promise<PageSuggestion[]> => {
          if (!bookId) return [];

          try {
            // Extract numeric ID from slug if needed
            const numericBookId = SlugService.extractId(bookId);
            if (!numericBookId) return [];

            // Fetch all pages for the current book
            const { data: pages, error } = await supabase
              .from('pages')
              .select('id, title, page_index, book_id')
              .eq('book_id', numericBookId)
              .eq('archived', false)
              .order('page_index');

            if (error || !pages) {
              console.error('Error fetching pages:', error);
              return [];
            }

            // Filter by query
            const filtered = query
              ? pages.filter((page) =>
                  page.title.toLowerCase().includes(query.toLowerCase())
                )
              : pages;

            // Group by title to detect duplicates
            const pagesByTitle = filtered.reduce((acc, page) => {
              if (!acc[page.title]) acc[page.title] = [];
              acc[page.title].push(page);
              return acc;
            }, {} as Record<string, Page[]>);

            // Add disambiguation info
            const suggestions: PageSuggestion[] = filtered.map((page) => {
              const duplicates = pagesByTitle[page.title];
              const displayTitle =
                duplicates.length > 1
                  ? `${page.title} (Page ${page.page_index + 1})`
                  : page.title;

              return {
                ...page,
                displayTitle,
              };
            });

            return suggestions.slice(0, 10); // Limit to 10 suggestions
          } catch (error) {
            console.error('Error fetching pages:', error);
            return [];
          }
        },

        command: ({ editor, range, props }) => {
          // Remove the [[ trigger and query text
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: 'text',
                text: props.title,
                marks: [
                  {
                    type: 'pageLink',
                    attrs: {
                      pageId: props.id,
                      title: props.title,
                      bookId: props.book_id,
                      broken: false,
                    },
                  },
                ],
              },
              {
                type: 'text',
                text: ' ', // Add space after link
              },
            ])
            .run();
        },

        render: () => {
          let component: ReactRenderer<PageListRef, PageListProps>;
          let popup: TippyInstance[];

          // Function to create a new page
          const createNewPage = async (title: string, editor: Editor, range: Range) => {
            if (!bookId) return;

            try {
              const numericBookId = SlugService.extractId(bookId);
              if (!numericBookId) return;

              // Call the create_next_page function to create a new page
              const { data: newPageData, error } = await supabase.rpc('create_next_page', {
                p_book_id: numericBookId,
              });

              if (error || !newPageData || !Array.isArray(newPageData) || newPageData.length === 0) {
                console.error('Error creating page:', error);
                return;
              }

              // The function returns an array with one row
              const newPage = newPageData[0];

              // Create initial content with H1 heading matching the title
              const initialContent = {
                type: 'doc',
                content: [
                  {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [
                      {
                        type: 'text',
                        text: title,
                      },
                    ],
                  },
                  {
                    type: 'paragraph',
                  },
                ],
              };

              // Update the page title and content
              const { data: updatedPage, error: updateError } = await supabase
                .from('pages')
                .update({
                  title,
                  content: initialContent,
                })
                .eq('id', newPage.id)
                .select('id, title, page_index, book_id')
                .single();

              if (updateError || !updatedPage) {
                console.error('Error updating page title:', updateError);
                return;
              }

              // Insert the link to the new page
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent([
                  {
                    type: 'text',
                    text: title,
                    marks: [
                      {
                        type: 'pageLink',
                        attrs: {
                          pageId: updatedPage.id,
                          title: updatedPage.title,
                          bookId: updatedPage.book_id.toString(),
                          broken: false,
                        },
                      },
                    ],
                  },
                  {
                    type: 'text',
                    text: ' ', // Add space after link
                  },
                ])
                .run();

              // Navigate to the newly created page
              if (onNavigateToPage) {
                onNavigateToPage(updatedPage.id.toString(), updatedPage.book_id.toString());
              }
            } catch (error) {
              console.error('Error creating new page:', error);
            }
          };

          return {
            onStart: (props) => {
              component = new ReactRenderer(PageList, {
                props: {
                  ...props,
                  onCreateNew: (title: string) => createNewPage(title, props.editor, props.range),
                },
                editor: props.editor,
              });

              if (!props.clientRect) {
                return;
              }

              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
                theme: 'none',
                maxWidth: 'none',
              });
            },

            onUpdate(props) {
              component.updateProps({
                ...props,
                onCreateNew: (title: string) => createNewPage(title, props.editor, props.range),
              });

              if (!props.clientRect) {
                return;
              }

              popup[0].setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },

            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup[0].hide();
                return true;
              }

              return component.ref?.onKeyDown(props) ?? false;
            },

            onExit() {
              popup[0].destroy();
              component.destroy();
            },
          };
        },
      } as SuggestionOptions<PageSuggestion>),
    ];
  },
});
