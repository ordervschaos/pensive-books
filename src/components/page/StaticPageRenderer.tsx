import { renderToReactElement } from '@tiptap/static-renderer/pm/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { SmartTypography } from '../editor/extensions/SmartTypography';
import { Title } from '../editor/extensions/Title';
import { common, createLowlight } from 'lowlight';
import { extractAudioBlocks } from '@/utils/audioBlockExtractor';
import { EditorJSON } from '@/types/editor';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from "@/lib/utils";

const lowlight = createLowlight(common);

interface StaticPageRendererProps {
  content: string | EditorJSON | null;
  className?: string;
  centerContent?: boolean;
}

/**
 * Pre-process content JSON to add audio block indices
 */
function addAudioBlocksToContent(content: EditorJSON | null): EditorJSON | null {
  if (!content || typeof content !== 'object') {
    return content;
  }

  // Check if audio blocks are enabled
  const enabled = typeof window !== 'undefined' && localStorage.getItem('audio_blocks_enabled') === 'true';
  if (!enabled) {
    return content;
  }

  // Extract audio blocks from the content
  const audioBlocks = extractAudioBlocks(content);

  // Create a map of text content to block index
  const blockIndexMap = new Map<string, number>();
  audioBlocks.forEach(block => {
    blockIndexMap.set(block.textContent.trim(), block.index);
  });

  // Deep clone the content to avoid mutations
  const processedContent = JSON.parse(JSON.stringify(content));

  // Recursively add audioBlock attributes to matching nodes
  function processNode(node: any): any {
    if (!node || typeof node !== 'object') {
      return node;
    }

    // Check if this is a block-level node that can have audio blocks
    const isAudioBlockNode = [
      'paragraph',
      'heading',
      'blockquote',
      'listItem',
      'codeBlock'
    ].includes(node.type);

    if (isAudioBlockNode) {
      // Extract text content from this node
      const nodeText = extractTextFromNode(node).trim();
      const blockIndex = blockIndexMap.get(nodeText);

      if (blockIndex !== undefined) {
        // Add the audioBlock attribute
        node.attrs = {
          ...node.attrs,
          audioBlock: blockIndex
        };
      }
    }

    // Process child nodes recursively
    if (node.content && Array.isArray(node.content)) {
      node.content = node.content.map(processNode);
    }

    return node;
  }

  // Helper function to extract text from a node
  function extractTextFromNode(node: any): string {
    if (node.type === 'text') {
      return node.text || '';
    }

    if (node.content && Array.isArray(node.content)) {
      return node.content.map((child: any) => extractTextFromNode(child)).join('');
    }

    return '';
  }

  // Process all top-level nodes
  if (processedContent.content && Array.isArray(processedContent.content)) {
    processedContent.content = processedContent.content.map(processNode);
  }

  return processedContent;
}

/**
 * StaticPageRenderer - Renders TipTap JSON content using static renderer
 * Much more efficient than loading the full editor for read-only content
 */
export const StaticPageRenderer = ({
  content,
  className = '',
  centerContent
}: StaticPageRendererProps) => {
  const isMobile = useIsMobile();

  // Parse content if it's a string
  let parsedContent: EditorJSON | null = null;
  if (typeof content === 'string') {
    try {
      parsedContent = JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse content:', e);
      return <div className="text-destructive">Failed to load content</div>;
    }
  } else {
    parsedContent = content;
  }

  // Pre-process content to add audio blocks
  const processedContent = addAudioBlocksToContent(parsedContent);

  if (!processedContent) {
    return <div className="text-muted-foreground">No content available</div>;
  }

  // Configure extensions with same settings as editor
  const extensions = [
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
      openOnClick: true,
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
      resizable: false, // Not resizable in read-only mode
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
  ];

  // Render content using static renderer
  const renderedContent = renderToReactElement({
    extensions,
    content: processedContent,
  });

  return (
    <div className="h-full flex flex-col min-h-[600px]">
      <div className={cn(
        `${centerContent ? 'flex items-center justify-center text-center' : ''} prose dark:prose-invert prose-slate w-full max-w-none p-8 flex-1 bg-background ${isMobile ? 'text-xl' : 'text-2xl'} ${className}`,
        '[&_img]:mx-auto [&_img]:block',
        '[&_p]:text-xl [&_p]:md:text-2xl [&_p]:leading-relaxed [&_p]:mb-6',
        '[&_table]:border-collapse [&_table]:w-full',
        '[&_th]:border [&_th]:border-muted [&_th]:p-2',
        '[&_td]:border [&_td]:border-muted [&_td]:p-2',
        '[&_.selectedCell]:bg-muted/30',
        '[&_pre]:text-lg [&_pre]:md:text-xl',
        '[&_code]:text-lg [&_code]:md:text-xl',
        '[&_h1]:text-4xl [&_h1]:font-bold [&_h1]:mb-8 [&_h1]:mt-0',
        '[&_h2]:text-3xl [&_h2]:font-bold [&_h2]:mb-6 [&_h2]:mt-8',
        '[&_h3]:text-2xl [&_h3]:font-bold [&_h3]:mb-4 [&_h3]:mt-6',
        '[&_h4]:text-xl [&_h4]:font-bold [&_h4]:mb-4 [&_h4]:mt-6',
        '[&_h5]:text-lg [&_h5]:font-bold [&_h5]:mb-4 [&_h5]:mt-6',
        '[&_h6]:text-base [&_h6]:font-bold [&_h6]:mb-4 [&_h6]:mt-6',
        '[&_h1,h2,h3,h4,h5,h6]:tracking-tight [&_h1,h2,h3,h4,h5,h6]:text-foreground'
      )}>
        {renderedContent}
      </div>
    </div>
  );
};
