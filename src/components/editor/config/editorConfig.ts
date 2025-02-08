import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Title } from '../extensions/Title';

// Create a new lowlight instance with common languages
export const lowlight = createLowlight(common);

export const getEditorConfig = (content: string, onChange: (html: string, json: any) => void, onTitleChange?: (title: string) => void, editable = true, isEditing = true) => {
  return {
    extensions: [
      Title,
      StarterKit.configure({
        blockquote: {
          HTMLAttributes: {
            class: 'border-l-4 border-primary pl-4 my-4 italic',
          },
        },
        bulletList: {
          HTMLAttributes: {
            class: 'list-disc list-outside ml-4 my-4 space-y-1',
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: 'list-decimal list-outside ml-4 my-4 space-y-1',
          },
        },
        listItem: {
          HTMLAttributes: {
            class: 'pl-1',
          },
        },
        code: {
          HTMLAttributes: {
            class: 'rounded-md bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm',
          },
        },
        codeBlock: false,
        heading: {
          levels: [2, 3, 4, 5, 6],
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'relative rounded-md bg-muted/50 my-4',
        },
        languageClassPrefix: 'language-',
      }).extend({
        addKeyboardShortcuts() {
          return {
            Tab: () => {
              if (this.editor.isActive('codeBlock')) {
                this.editor.commands.insertContent('\t');
                return true;
              }
              return false;
            },
          };
        },
        renderHTML({ node, HTMLAttributes }) {
          const languageClass = node.attrs.language ? ` language-${node.attrs.language}` : '';
          
          return [
            'div', 
            { class: `relative rounded-md bg-muted/50 my-4 group ${HTMLAttributes.class || ''}` },
            [
              'div',
              { class: 'flex items-center justify-between px-4 py-2 border-b border-muted' },
              [
                'span',
                { class: 'text-sm text-muted-foreground' },
                node.attrs.language || 'plain text'
              ],
              [
                'button',
                { 
                  class: 'copy-button opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground',
                  'data-code': node.textContent
                },
                [
                  'svg',
                  {
                    xmlns: 'http://www.w3.org/2000/svg',
                    width: '16',
                    height: '16',
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    stroke: 'currentColor',
                    'stroke-width': '2',
                    'stroke-linecap': 'round',
                    'stroke-linejoin': 'round'
                  },
                  [
                    'rect',
                    { 
                      x: '9',
                      y: '9',
                      width: '13',
                      height: '13',
                      rx: '2',
                      ry: '2'
                    }
                  ],
                  [
                    'path',
                    { 
                      d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'
                    }
                  ]
                ]
              ]
            ],
            [
              'pre',
              { class: 'overflow-x-auto p-4 text-sm' },
              [
                'code',
                { class: `hljs${languageClass}` },
                0
              ]
            ]
          ];
        }
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-500 dark:text-blue-400 underline',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg',
        },
      }),
    ],
    content,
    editable: editable && isEditing,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML(), editor.getJSON());

      if (onTitleChange) {
        const titleNode = editor.getJSON().content.find((node: any) => node.type === 'title');
        const title = titleNode?.content?.[0]?.text || '';
        onTitleChange(title);
      }
    },
    editorProps: {
      handleKeyDown: (view: any, event: any) => {
        if (view.state.selection.$anchor.parent.type.name === 'title') {
          if (event.key === 'b' && (event.ctrlKey || event.metaKey)) return true;
          if (event.key === 'i' && (event.ctrlKey || event.metaKey)) return true;
        }
      },
    },
    autofocus: 'start' as const,
  };
};