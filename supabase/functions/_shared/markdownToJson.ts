/**
 * Convert markdown to TipTap JSON format
 * This is a Deno-compatible implementation for Edge Functions
 */

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
  attrs?: Record<string, any>;
}

interface TipTapDocument {
  type: 'doc';
  content: TipTapNode[];
}

/**
 * Parse markdown text into TipTap JSON format
 */
export function markdownToJson(markdown: string): TipTapDocument {
  const lines = markdown.split('\n');
  const content: TipTapNode[] = [];
  let currentParagraph: TipTapNode[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLanguage = '';
  let inList = false;
  let listItems: TipTapNode[] = [];
  let listType: 'bulletList' | 'orderedList' = 'bulletList';

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      content.push({
        type: 'paragraph',
        content: currentParagraph,
      });
      currentParagraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      content.push({
        type: listType,
        content: listItems,
      });
      listItems = [];
      inList = false;
    }
  };

  const parseInlineContent = (text: string): TipTapNode[] => {
    const nodes: TipTapNode[] = [];
    let currentText = '';
    let i = 0;

    const addTextNode = (content: string, marks: { type: string }[] = []) => {
      if (content) {
        nodes.push({
          type: 'text',
          text: content,
          ...(marks.length > 0 && { marks }),
        });
      }
    };

    while (i < text.length) {
      // Bold (**text** or __text__)
      if ((text[i] === '*' && text[i + 1] === '*') || (text[i] === '_' && text[i + 1] === '_')) {
        addTextNode(currentText);
        currentText = '';
        const delimiter = text[i];
        i += 2;
        let boldText = '';
        while (i < text.length - 1 && !(text[i] === delimiter && text[i + 1] === delimiter)) {
          boldText += text[i];
          i++;
        }
        if (i < text.length - 1) {
          addTextNode(boldText, [{ type: 'bold' }]);
          i += 2;
        }
      }
      // Italic (*text* or _text_)
      else if (text[i] === '*' || text[i] === '_') {
        addTextNode(currentText);
        currentText = '';
        const delimiter = text[i];
        i++;
        let italicText = '';
        while (i < text.length && text[i] !== delimiter) {
          italicText += text[i];
          i++;
        }
        if (i < text.length) {
          addTextNode(italicText, [{ type: 'italic' }]);
          i++;
        }
      }
      // Code (`text`)
      else if (text[i] === '`') {
        addTextNode(currentText);
        currentText = '';
        i++;
        let codeText = '';
        while (i < text.length && text[i] !== '`') {
          codeText += text[i];
          i++;
        }
        if (i < text.length) {
          addTextNode(codeText, [{ type: 'code' }]);
          i++;
        }
      }
      // Link [text](url)
      else if (text[i] === '[') {
        addTextNode(currentText);
        currentText = '';
        i++;
        let linkText = '';
        while (i < text.length && text[i] !== ']') {
          linkText += text[i];
          i++;
        }
        if (i < text.length && text[i + 1] === '(') {
          i += 2;
          let url = '';
          while (i < text.length && text[i] !== ')') {
            url += text[i];
            i++;
          }
          if (i < text.length) {
            nodes.push({
              type: 'text',
              text: linkText,
              marks: [{ type: 'link', attrs: { href: url } }],
            });
            i++;
          }
        }
      } else {
        currentText += text[i];
        i++;
      }
    }

    addTextNode(currentText);
    return nodes;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Code blocks
    if (trimmedLine.startsWith('```')) {
      flushParagraph();
      flushList();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLanguage = trimmedLine.substring(3).trim();
        codeBlockContent = [];
      } else {
        content.push({
          type: 'codeBlock',
          attrs: codeBlockLanguage ? { language: codeBlockLanguage } : {},
          content: [
            {
              type: 'text',
              text: codeBlockContent.join('\n'),
            },
          ],
        });
        inCodeBlock = false;
        codeBlockContent = [];
        codeBlockLanguage = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Empty line
    if (!trimmedLine) {
      flushParagraph();
      flushList();
      continue;
    }

    // Headings
    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      content.push({
        type: 'heading',
        attrs: { level },
        content: parseInlineContent(headingMatch[2]),
      });
      continue;
    }

    // Blockquote
    if (trimmedLine.startsWith('>')) {
      flushParagraph();
      flushList();
      const quoteText = trimmedLine.substring(1).trim();
      content.push({
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: parseInlineContent(quoteText),
          },
        ],
      });
      continue;
    }

    // Bullet list
    const bulletMatch = trimmedLine.match(/^[-*+]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      if (!inList || listType !== 'bulletList') {
        flushList();
        inList = true;
        listType = 'bulletList';
      }
      listItems.push({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: parseInlineContent(bulletMatch[1]),
          },
        ],
      });
      continue;
    }

    // Ordered list
    const orderedMatch = trimmedLine.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (!inList || listType !== 'orderedList') {
        flushList();
        inList = true;
        listType = 'orderedList';
      }
      listItems.push({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: parseInlineContent(orderedMatch[1]),
          },
        ],
      });
      continue;
    }

    // Horizontal rule
    if (trimmedLine.match(/^(---|\*\*\*|___)+$/)) {
      flushParagraph();
      flushList();
      content.push({
        type: 'horizontalRule',
      });
      continue;
    }

    // Regular paragraph text
    flushList();
    const inlineContent = parseInlineContent(trimmedLine);
    if (currentParagraph.length > 0) {
      // Add line break and continue paragraph
      currentParagraph.push({ type: 'hardBreak' });
      currentParagraph.push(...inlineContent);
    } else {
      currentParagraph.push(...inlineContent);
    }
  }

  // Flush any remaining content
  flushParagraph();
  flushList();

  return {
    type: 'doc',
    content,
  };
}
