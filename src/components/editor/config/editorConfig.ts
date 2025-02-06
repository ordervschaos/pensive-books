
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
        defaultLanguage: 'javascript',
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
          const languageClass = node.attrs.language ? ` language-${node.attrs.language}` : ''
          const codeBlockId = `code-block-${Math.random().toString(36).substr(2, 9)}`
          
          const wrapper = document.createElement('div')
          wrapper.className = `relative rounded-md bg-muted/50 my-4 group ${HTMLAttributes.class || ''}`
          
          const header = document.createElement('div')
          header.className = 'flex items-center justify-between px-4 py-2 border-b border-muted'
          
          const languageIndicator = document.createElement('span')
          languageIndicator.className = 'text-sm text-muted-foreground'
          languageIndicator.textContent = node.attrs.language || 'plain text'
          header.appendChild(languageIndicator)
          
          const copyButton = document.createElement('button')
          copyButton.className = 'copy-button opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground'
          copyButton.setAttribute('data-code', node.textContent)
          copyButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
          header.appendChild(copyButton)
          
          wrapper.appendChild(header)
          
          const pre = document.createElement('pre')
          pre.className = 'overflow-x-auto p-4 text-sm'
          
          const code = document.createElement('code')
          code.className = `hljs${languageClass}`
          code.id = codeBlockId
          code.innerHTML = node.textContent
          
          pre.appendChild(code)
          wrapper.appendChild(pre)
          
          return wrapper
        },
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

