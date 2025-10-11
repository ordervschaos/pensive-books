import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { Title } from '../extensions/Title';
import { SmartTypography } from '../extensions/SmartTypography';
import { common, createLowlight } from 'lowlight';
import { useSupabaseUpload } from '@/hooks/use-supabase-upload';

export const lowlight = createLowlight(common);

export const getEditorConfig = (content: string, onChange: (html: string, json?: any) => void, editable = true, isEditing = true) => {
  const uploadImage = useSupabaseUpload();

  return {
    extensions: [
      Title,
      SmartTypography,
      StarterKit.configure({
        document: false,
        blockquote: {
          HTMLAttributes: {
            class: 'border-l-4 border-primary pl-4 my-4 italic',
          },
        },
        heading: {
          levels: [1, 2, 3, 4, 5, 6]
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
            'pre',
            { class: 'overflow-x-auto p-4 text-sm bg-muted/50 rounded-md my-4' },
            [
              'code',
              { class: `hljs${languageClass}` },
              0
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
          class: 'max-w-full h-auto rounded-lg preserve-animation mx-auto block',
        },
        allowBase64: true,
        inline: false,
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse table-auto w-full my-4',
        },
      }),
      TableRow.configure({
        HTMLAttributes: {
          class: 'border-b border-muted',
        },
      }),
      TableHeader.configure({
        HTMLAttributes: {
          class: 'border-b-2 border-muted bg-muted/50 font-bold text-left p-2',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-muted p-2',
        },
      }),
    ],
    content,
    editable: editable && isEditing,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML(), editor.getJSON());
    },
    editorProps: {
      handleDrop: (view: any, event: any, slice: any, moved: boolean) => {
        if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
          const file = event.dataTransfer.files[0];
          if (file.type.startsWith('image/')) {
            event.preventDefault();
            
            const isGif = file.type === 'image/gif';
            uploadImage(file).upload({ preserveAnimation: isGif }).then(({ default: url }) => {
              const { schema } = view.state;
              const node = schema.nodes.image.create({ src: url });
              const transaction = view.state.tr.replaceSelectionWith(node);
              view.dispatch(transaction);
            });
            
            return true;
          }
        }
        return false;
      },
      handlePaste: (view: any, event: any, slice: any) => {
        const items = event.clipboardData?.items;
        if (!items) return false;

        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            
            const isGif = item.type === 'image/gif';
            uploadImage(file).upload({ preserveAnimation: isGif }).then(({ default: url }) => {
              const { schema } = view.state;
              const node = schema.nodes.image.create({ src: url });
              const transaction = view.state.tr.replaceSelectionWith(node);
              view.dispatch(transaction);
            });
            
            return true;
          }
        }
        
        return false;
      },
    },
    autofocus: 'start' as const,
  };
};
