import JSZip from 'jszip';

interface Page {
  title: string | null;
  html_content: string | null;
  page_type: 'section' | 'page';
  page_index: number;
}

interface EPUBImage {
  id: string;
  url: string;
  blob: Blob;
}

interface EPUBMetadata {
  title: string;
  subtitle?: string | null;
  author?: string | null;
  language?: string;
  identifier?: string;
  coverUrl?: string | null;
}

// Sanitize HTML content for XHTML compatibility
export const sanitizeContent = (html: string): string => {
  if (!html) return '';
  
  return html
    // Replace HTML entities with their XML equivalents
    .replace(/&nbsp;/g, '&#160;')
    .replace(/&ldquo;/g, '&#8220;')
    .replace(/&rdquo;/g, '&#8221;')
    .replace(/&lsquo;/g, '&#8216;')
    .replace(/&rsquo;/g, '&#8217;')
    .replace(/&mdash;/g, '&#8212;')
    .replace(/&ndash;/g, '&#8211;')
    .replace(/&hellip;/g, '&#8230;')
    .replace(/&amp;/g, '&#38;')
    .replace(/&lt;/g, '&#60;')
    .replace(/&gt;/g, '&#62;')
    .replace(/&quot;/g, '&#34;')
    .replace(/&apos;/g, '&#39;')
    // Ensure all tags are properly closed
    .replace(/<br>/g, '<br/>')
    .replace(/<hr>/g, '<hr/>')
    .replace(/<img ([^>]*)>/g, '<img $1/>')
    // Remove any script tags and their content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove any style tags and their content
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Remove any comments
    .replace(/<!--[\s\S]*?-->/g, '');
};

// Escape text for XML
export const escapeXml = (text: string): string => {
  if (!text) return '';
  return text.replace(/&/g, '&#38;');
};

// Generate container.xml content
export const generateContainerXml = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

// Generate content.opf content
export const generateContentOpf = (metadata: EPUBMetadata, images: EPUBImage[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeXml(metadata.subtitle ? `${metadata.title}: ${metadata.subtitle}` : metadata.title)}</dc:title>
    ${metadata.author ? `<dc:creator>${escapeXml(metadata.author)}</dc:creator>` : ''}
    <dc:language>${metadata.language || 'en'}</dc:language>
    <dc:identifier id="BookId">urn:uuid:${metadata.identifier || crypto.randomUUID()}</dc:identifier>
    <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="styles.css" media-type="text/css"/>
    ${metadata.coverUrl ? '<item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>' : ''}
    ${images.map(img => `<item id="${img.id}" href="images/${img.id}" media-type="${img.blob.type}"/>`).join('\n    ')}
  </manifest>
  <spine toc="ncx">
    <itemref idref="nav"/>
    <itemref idref="content"/>
  </spine>
  <guide>
    <reference type="toc" title="Table of Contents" href="nav.xhtml"/>
  </guide>
</package>`;

// Generate nav.xhtml content
export const generateNavXhtml = (pages: Page[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <title>Table of Contents</title>
  <meta charset="UTF-8"/>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
      ${(() => {
        let currentSection = '';
        let sectionCount = 0;
        let pageCount = 0;
        let html = '';

        pages.forEach((page, index) => {
          if (page.page_type === 'section') {
            // Close previous section's nested list if exists
            if (currentSection) {
              html += '</ol></li>';
            }
            // Start new section
            sectionCount++;
            currentSection = page.title || `Section ${sectionCount}`;
            html += `
              <li>
                <a href="content.xhtml#page${index}">${escapeXml(currentSection)}</a>
                <ol>`;
          } else {
            // Add page under current section
            pageCount++;
            const title = page.title || `Page ${pageCount}`;
            html += `
              <li>
                <a href="content.xhtml#page${index}">${escapeXml(title)}</a>
              </li>`;
          }
        });

        // Close last section if exists
        if (currentSection) {
          html += '</ol></li>';
        }

        return html;
      })()}
    </ol>
  </nav>
</body>
</html>`;

// Generate NCX content for backward compatibility
export const generateTocNcx = (metadata: EPUBMetadata, pages: Page[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${metadata.identifier || crypto.randomUUID()}"/>
    <meta name="dtb:depth" content="2"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${escapeXml(metadata.title)}</text>
  </docTitle>
  ${metadata.author ? `<docAuthor><text>${escapeXml(metadata.author)}</text></docAuthor>` : ''}
  <navMap>
    ${(() => {
      let currentSection = '';
      let sectionCount = 0;
      let pageCount = 0;
      let playOrder = 1;
      let navPoints = '';

      pages.forEach((page, index) => {
        if (page.page_type === 'section') {
          sectionCount++;
          currentSection = page.title || `Section ${sectionCount}`;
          navPoints += `
            <navPoint id="section${sectionCount}" playOrder="${playOrder++}">
              <navLabel>
                <text>${escapeXml(currentSection)}</text>
              </navLabel>
              <content src="content.xhtml#page${index}"/>`;
        } else {
          pageCount++;
          const title = page.title || `Page ${pageCount}`;
          navPoints += `
            <navPoint id="page${pageCount}" playOrder="${playOrder++}">
              <navLabel>
                <text>${escapeXml(title)}</text>
              </navLabel>
              <content src="content.xhtml#page${index}"/>
            </navPoint>`;
        }
      });

      // Close any open section navPoints
      if (currentSection) {
        navPoints += '</navPoint>';
      }

      return navPoints;
    })()}
  </navMap>
</ncx>`;

// Generate content.xhtml content
export const generateContentXhtml = (metadata: EPUBMetadata, pages: Page[], show_text_on_cover: boolean = true): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <title>${escapeXml(metadata.title)}</title>
  <meta charset="UTF-8"/>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  ${metadata.coverUrl ? `
  <div class="cover-page">
    <img src="cover.jpg" alt="Cover" class="cover-image"/>
  </div>
  ` : `
  <div class="cover-page">
      <div class="title-group">
        <h1 class="book-title">${escapeXml(metadata.title)}</h1>
        ${metadata.subtitle ? `<h2 class="book-subtitle">${escapeXml(metadata.subtitle)}</h2>` : ''}
      </div>
      ${metadata.author ? `<h3 class="book-author">by ${escapeXml(metadata.author)}</h3>` : ''}
  </div>
  `}
  ${pages.map((page, index) => `
    <section id="page${index}" epub:type="chapter" class="${page.page_type === 'section' ? 'section-page' : 'content-page'}">
      ${page.page_type === 'section' 
        ? `<h2 class="section-title">${escapeXml(page.title || 'Untitled Section')}</h2>`
        : `
          <article>
            <div class="page-content">${page.html_content ? sanitizeContent(page.html_content) : ''}</div>
          </article>
        `}
    </section>
  `).join('\n')}
</body>
</html>`;

// Generate CSS styles
export const generateStyles = (): string => `
@page {
  margin: 0;
  padding: 0;
}

body {
  font-family: serif;
  line-height: 1.5;
  margin: 0;
  padding: 0;
}

.cover-page {
  height: 100vh;
  width: 100%;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  page-break-after: always;
  position: relative;
  overflow: hidden;
}

.cover-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.title-group {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
}

.book-title {
  font-size: 3.2em;
  font-weight: bold;
  margin: 0;
  color: #333;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.book-subtitle {
  font-size: 1.8em;
  color: #555;
  margin: 0;
  font-weight: normal;
  line-height: 1.4;
  font-style: italic;
}

.book-author {
  font-size: 1.4em;
  color: #444;
  margin: 0;
  font-weight: normal;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-page {
  min-height: 70vh;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  page-break-after: always;
}

.section-title {
  font-size: 2em;
  font-weight: bold;
  color: #333;
  margin: 1em 0;
}

.content-page {
  margin: 2em 0;
  page-break-after: always;
}

.page-title {
  font-size: 1.5em;
  font-weight: bold;
  color: #333;
  margin: 1em 0;
}

.page-content {
  font-size: 1em;
  line-height: 1.6;
}

img {
  max-width: 95%;
  height: auto;
  margin: 1em auto;
  display: block;
  page-break-inside: avoid;
}

a {
  color: #0066cc;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

blockquote {
  margin: 1em 0;
  padding: 0 1em;
  border-left: 3px solid #ccc;
  color: #666;
}

code {
  font-family: monospace;
  background: #f5f5f5;
  padding: 0.2em 0.4em;
  border-radius: 3px;
}

pre {
  background: #f5f5f5;
  padding: 1em;
  overflow-x: auto;
  border-radius: 3px;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

th, td {
  border: 1px solid #ddd;
  padding: 0.5em;
  text-align: left;
}

th {
  background: #f5f5f5;
}
`;

// Update the function signature to include the show_text_on_cover parameter
export const generateCoverImage = async (
  metadata: EPUBMetadata, 
  show_text_on_cover: boolean = true
): Promise<Blob> => {
  // Create a canvas element
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Set canvas dimensions (standard ebook cover ratio)
  canvas.width = 1600;
  canvas.height = 2560;
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  // Fill background with gradient if no cover image
  if (!metadata.coverUrl) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#1a3c5a');
    gradient.addColorStop(1, '#0f2439');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    // Load and draw background image
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      // Wait for image to load
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = metadata.coverUrl;
      });
      
      // Calculate dimensions to ensure full coverage (cover approach)
      let drawWidth = canvas.width;
      let drawHeight = canvas.height;
      let offsetX = 0;
      let offsetY = 0;
      
      const imgRatio = img.width / img.height;
      const canvasRatio = canvas.width / canvas.height;
      
      if (imgRatio > canvasRatio) {
        // Image is wider than canvas ratio - match height and crop width
        drawWidth = canvas.height * imgRatio;
        offsetX = (canvas.width - drawWidth) / 2;
      } else {
        // Image is taller than canvas ratio - match width and crop height
        drawHeight = canvas.width / imgRatio;
        offsetY = (canvas.height - drawHeight) / 2;
      }
      
      // Fill background with black
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw image to cover entire canvas (may crop sides)
      ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
      
      // Add semi-transparent overlay for better text visibility only if showing text
      if (show_text_on_cover) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    } catch (error) {
      console.warn('Failed to load cover image, using gradient instead:', error);
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, '#1a3c5a');
      gradient.addColorStop(1, '#0f2439');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  
  // Only add text if show_text_on_cover is true
  if (show_text_on_cover) {
    // Calculate responsive font size for title
    const calculateFontSize = (text: string): number => {
      // Base size and constraints
      const maxFontSize = 200;
      const minFontSize = 100;
      const maxWidth = canvas.width - 160;
      
      // Start with max size and reduce until it fits
      let fontSize = maxFontSize;
      
      // Adjust based on title length
      if (text.length > 0) {
        // Rough estimate: longer titles get smaller fonts
        fontSize = Math.max(minFontSize, maxFontSize - (text.length * 2));
        
        // Fine-tune by measuring actual text width
        ctx.font = `bold ${fontSize}px serif`;
        let textWidth = ctx.measureText(text).width;
        
        // If single line is too wide, reduce font size
        while (textWidth > maxWidth && fontSize > minFontSize) {
          fontSize -= 5;
          ctx.font = `bold ${fontSize}px serif`;
          textWidth = ctx.measureText(text).width;
        }
      }
      
      return fontSize;
    };
    
    // Handle multiline text wrapping
    const wrapText = (text: string, maxWidth: number, fontSize: number): string[] => {
      const words = text.split(' ');
      const lines: string[] = [];
      let currentLine = words[0];
      
      ctx.font = `bold ${fontSize}px serif`;
      
      for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + ' ' + word).width;
        if (width < maxWidth) {
          currentLine += ' ' + word;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
      lines.push(currentLine);
      return lines;
    };
    
    // Set text styles
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;
    
    // Calculate and set responsive font size for title
    const titleFontSize = calculateFontSize(metadata.title);
    ctx.font = `bold ${titleFontSize}px serif`;
    
    // Draw title with responsive font size
    const maxTitleWidth = canvas.width - 160;
    const titleLines = wrapText(metadata.title, maxTitleWidth, titleFontSize);
    
    // Calculate vertical position for title (centered, with space for subtitle and author)
    const titleLineHeight = titleFontSize * 1.2;
    const titleTotalHeight = titleLines.length * titleLineHeight;
    let titleY = canvas.height / 2 - titleTotalHeight / 2;
    
    // If we have subtitle or author, shift title up a bit
    if (metadata.subtitle || metadata.author) {
      titleY -= 150;
    }
    
    // Draw title lines
    titleLines.forEach((line, index) => {
      ctx.fillText(line, canvas.width / 2, titleY + index * titleLineHeight);
    });
    
    // Calculate bottom position of title text
    const titleBottom = titleY + titleLines.length * titleLineHeight;
    
    // Draw subtitle if exists
    if (metadata.subtitle) {
      // Calculate responsive font size for subtitle (smaller than title)
      const subtitleFontSize = Math.max(70, titleFontSize * 0.6);
      ctx.font = `italic ${subtitleFontSize}px serif`;
      
      const subtitleLines = wrapText(metadata.subtitle, canvas.width - 240, subtitleFontSize);
      const subtitleLineHeight = subtitleFontSize * 1.2;
      
      // Position subtitle below title with some spacing
      const subtitleY = titleBottom + 100;
      
      subtitleLines.forEach((line, index) => {
        ctx.fillText(line, canvas.width / 2, subtitleY + index * subtitleLineHeight);
      });
      
      // Update bottom position for author positioning
      const subtitleBottom = subtitleY + subtitleLines.length * subtitleLineHeight;
      
      // Draw author if exists
      if (metadata.author) {
        const authorFontSize = Math.max(60, subtitleFontSize * 0.8);
        ctx.font = `${authorFontSize}px serif`;
        ctx.fillText(`by ${metadata.author}`, canvas.width / 2, subtitleBottom + 100);
      }
    } else if (metadata.author) {
      // If no subtitle but author exists
      const authorFontSize = Math.max(70, titleFontSize * 0.5);
      ctx.font = `${authorFontSize}px serif`;
      ctx.fillText(`by ${metadata.author}`, canvas.width / 2, titleBottom + 100);
    }
    
    // Reset shadow for better performance
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
  
  // Convert canvas to blob
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to generate cover image'));
      }
    }, 'image/jpeg', 0.9);
  });
};

// Update the generateEPUB function to pass the show_text_on_cover parameter
export const generateEPUB = async (
  metadata: EPUBMetadata,
  pages: Page[],
  images: EPUBImage[] = [],
  show_text_on_cover: boolean = true
): Promise<Blob> => {
  const zip = new JSZip();

  // Add mimetype file first (must be uncompressed)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // Add META-INF directory
  zip.file('META-INF/container.xml', generateContainerXml());

  // Generate cover image
  let coverBlob: Blob | null = null;
  if (metadata.coverUrl) {
    try {
      // Generate a complete cover image with title, author, etc. based on show_text_on_cover
      coverBlob = await generateCoverImage(metadata, show_text_on_cover);
      zip.file('OEBPS/cover.jpg', coverBlob);
    } catch (error) {
      console.warn('Failed to add cover image:', error);
    }
  } else {
    // If no cover URL provided, still generate a cover with title/author on gradient background
    try {
      coverBlob = await generateCoverImage(metadata, show_text_on_cover);
      zip.file('OEBPS/cover.jpg', coverBlob);
      // Update metadata to include the generated cover
      metadata = { ...metadata, coverUrl: 'cover.jpg' };
    } catch (error) {
      console.warn('Failed to generate cover image:', error);
    }
  }

  // Add OEBPS directory
  zip.file('OEBPS/content.opf', generateContentOpf(metadata, images));
  zip.file('OEBPS/nav.xhtml', generateNavXhtml(pages));
  zip.file('OEBPS/toc.ncx', generateTocNcx(metadata, pages));
  zip.file('OEBPS/content.xhtml', generateContentXhtml(metadata, pages, show_text_on_cover));
  zip.file('OEBPS/styles.css', generateStyles());

  // Add content images
  for (const image of images) {
    zip.file(`OEBPS/images/${image.id}`, image.blob);
  }

  // Generate the EPUB file
  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
}; 