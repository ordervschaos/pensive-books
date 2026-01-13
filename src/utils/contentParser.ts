/**
 * Utility functions for parsing TipTap content and extracting hierarchical structures
 */

export interface HeadingNode {
  type: 'heading';
  level: number;
  text: string;
  children?: ContentNode[];
}

export interface ParagraphNode {
  type: 'paragraph' | 'text' | 'other';
  text: string;
  content?: any; // Store original TipTap node for proper rendering
}

export type ContentNode = HeadingNode | ParagraphNode;

export interface PageOutline {
  pageId: number;
  pageTitle: string;
  pageType: 'text' | 'section';
  pageIndex: number;
  topLevelHeadings: HeadingNode[];
  hasContent: boolean;
}

/**
 * Extract text from a TipTap node
 */
const extractTextFromNode = (node: any): string => {
  if (node.type === 'text') {
    return node.text || '';
  }

  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join('');
  }

  return '';
};

/**
 * Determine the topmost heading level in content
 * Returns the smallest heading level found (1 is highest priority)
 */
const getTopmostHeadingLevel = (content: any): number | null => {
  if (!content || !content.content) return null;

  let minLevel: number | null = null;

  const traverse = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === 'heading') {
        const level = node.attrs?.level || 1;
        if (minLevel === null || level < minLevel) {
          minLevel = level;
        }
      }
      if (node.content && Array.isArray(node.content)) {
        traverse(node.content);
      }
    }
  };

  if (content.content && Array.isArray(content.content)) {
    traverse(content.content);
  }

  return minLevel;
};

/**
 * Parse TipTap JSON content into a hierarchical structure
 */
export const parseContentHierarchy = (content: any, topLevel: number): HeadingNode[] => {
  if (!content || !content.content) return [];

  const headings: HeadingNode[] = [];
  let currentHeading: HeadingNode | null = null;
  let currentContent: ContentNode[] = [];

  const processNode = (node: any) => {
    if (node.type === 'heading') {
      const level = node.attrs?.level || 1;
      const text = extractTextFromNode(node);

      if (level === topLevel) {
        // Save previous heading if exists
        if (currentHeading && currentContent.length > 0) {
          currentHeading.children = currentContent;
        }

        // Start new top-level heading
        currentHeading = {
          type: 'heading',
          level,
          text,
          children: []
        };
        headings.push(currentHeading);
        currentContent = [];
      } else if (level > topLevel && currentHeading) {
        // This is a subheading or content under current heading
        currentContent.push({
          type: 'heading',
          level,
          text,
          children: []
        });
      }
    } else if (currentHeading) {
      // Other content (paragraphs, lists, etc.)
      const text = extractTextFromNode(node);
      if (text.trim()) {
        currentContent.push({
          type: node.type || 'other',
          text: text.substring(0, 200), // Limit preview text
          content: node // Store the original node for proper rendering
        });
      }
    }
  };

  if (content.content && Array.isArray(content.content)) {
    content.content.forEach(processNode);
  }

  // Save last heading
  if (currentHeading && currentContent.length > 0) {
    currentHeading.children = currentContent;
  }

  return headings;
};

/**
 * Build a hierarchical tree from flat heading list
 */
const buildHeadingTree = (headings: HeadingNode[]): HeadingNode[] => {
  if (headings.length === 0) return [];

  const root: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const heading of headings) {
    // Pop stack until we find a heading with lower level (parent)
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // This is a root-level heading
      root.push(heading);
    } else {
      // Add as child of the last heading in stack
      const parent = stack[stack.length - 1];
      if (!parent.children) {
        parent.children = [];
      }
      parent.children.push(heading);
    }

    stack.push(heading);
  }

  return root;
};

/**
 * Extract full heading hierarchy for nested expansion
 */
export const extractFullHeadingHierarchy = (content: any): HeadingNode[] => {
  if (!content || !content.content) return [];

  const headings: HeadingNode[] = [];
  let currentHeading: HeadingNode | null = null;
  let contentNodes: ContentNode[] = [];

  const processNode = (node: any) => {
    if (node.type === 'heading') {
      // Save content for previous heading
      if (currentHeading && contentNodes.length > 0) {
        if (!currentHeading.children) {
          currentHeading.children = [];
        }
        currentHeading.children.push(...contentNodes);
      }

      const level = node.attrs?.level || 1;
      const text = extractTextFromNode(node);

      currentHeading = {
        type: 'heading',
        level,
        text,
        children: []
      };
      headings.push(currentHeading);
      contentNodes = [];
    } else if (currentHeading) {
      // Collect non-heading content
      const text = extractTextFromNode(node);
      if (text.trim()) {
        contentNodes.push({
          type: node.type || 'other',
          text: text.substring(0, 200),
          content: node
        });
      }
    }
  };

  if (content.content && Array.isArray(content.content)) {
    content.content.forEach(processNode);
  }

  // Save content for last heading
  if (currentHeading && contentNodes.length > 0) {
    if (!currentHeading.children) {
      currentHeading.children = [];
    }
    currentHeading.children.push(...contentNodes);
  }

  return buildHeadingTree(headings);
};

/**
 * Extract content under a specific heading
 */
export const extractContentUnderHeading = (content: any, headingText: string): string => {
  if (!content || !content.content) return '';

  let foundHeading = false;
  let contentParts: string[] = [];

  const processNode = (node: any, isAfterHeading: boolean): boolean => {
    if (node.type === 'heading') {
      const text = extractTextFromNode(node);
      if (text === headingText) {
        foundHeading = true;
        return true;
      } else if (isAfterHeading) {
        // Hit another heading, stop collecting
        return false;
      }
    } else if (isAfterHeading) {
      const text = extractTextFromNode(node);
      if (text.trim()) {
        contentParts.push(text);
      }
    }

    return isAfterHeading;
  };

  if (content.content && Array.isArray(content.content)) {
    let isAfterHeading = false;
    for (const node of content.content) {
      isAfterHeading = processNode(node, isAfterHeading);
      if (foundHeading && !isAfterHeading && contentParts.length > 0) {
        break;
      }
    }
  }

  return contentParts.join(' ').substring(0, 500);
};

/**
 * Parse pages into outline structure with full hierarchy
 */
export const parsePagesIntoOutline = (pages: any[]): PageOutline[] => {
  return pages.map(page => {
    const pageTitle = page.title || 'Untitled';
    const headings = extractFullHeadingHierarchy(page.content);

    return {
      pageId: page.id,
      pageTitle: pageTitle,
      pageType: page.page_type,
      pageIndex: page.page_index,
      topLevelHeadings: headings,
      hasContent: !!page.content && !!page.content.content && page.content.content.length > 0
    };
  });
};
