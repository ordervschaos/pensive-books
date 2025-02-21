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
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    ${metadata.subtitle ? `<meta property="title-type" refines="#title">main</meta>
    <dc:title id="subtitle">${escapeXml(metadata.subtitle)}</dc:title>
    <meta property="title-type" refines="#subtitle">subtitle</meta>` : ''}
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
  <div class="cover-page" style="background-image: url('cover.jpg');">
    <div class="cover-overlay"></div>
    ${show_text_on_cover ? `
      <div class="cover-content">
        <div class="title-group">
          <h1 class="book-title">${escapeXml(metadata.title)}</h1>
          ${metadata.subtitle ? `<h2 class="book-subtitle">${escapeXml(metadata.subtitle)}</h2>` : ''}
        </div>
        ${metadata.author ? `<h3 class="book-author">by ${escapeXml(metadata.author)}</h3>` : ''}
      </div>
    ` : ''}
  </div>
  ` : `
  <div class="cover-page">
    ${show_text_on_cover ? `
      <div class="title-group">
        <h1 class="book-title">${escapeXml(metadata.title)}</h1>
        ${metadata.subtitle ? `<h2 class="book-subtitle">${escapeXml(metadata.subtitle)}</h2>` : ''}
      </div>
      ${metadata.author ? `<h3 class="book-author">by ${escapeXml(metadata.author)}</h3>` : ''}
    ` : ''}
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
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  position: relative;
}

.cover-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(to bottom, 
    rgba(0, 0, 0, 0.4) 0%,
    rgba(0, 0, 0, 0.6) 50%,
    rgba(0, 0, 0, 0.8) 100%
  );
  z-index: 1;
}

.cover-content {
  position: relative;
  z-index: 2;
  padding: 2em;
  width: 85%;
  max-width: 800px;
  display: flex;
  flex-direction: column;
  gap: 2em;
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
  color: #fff;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.book-subtitle {
  font-size: 1.8em;
  color: rgba(255, 255, 255, 0.9);
  margin: 0;
  font-weight: normal;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
  line-height: 1.4;
  font-style: italic;
}

.book-author {
  font-size: 1.4em;
  color: rgba(255, 255, 255, 0.95);
  margin: 0;
  font-weight: normal;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
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

// Generate EPUB file
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

  // Add OEBPS directory
  zip.file('OEBPS/content.opf', generateContentOpf(metadata, images));
  zip.file('OEBPS/nav.xhtml', generateNavXhtml(pages));
  zip.file('OEBPS/toc.ncx', generateTocNcx(metadata, pages));
  zip.file('OEBPS/content.xhtml', generateContentXhtml(metadata, pages, show_text_on_cover));
  zip.file('OEBPS/styles.css', generateStyles());

  // Add cover image if provided
  if (metadata.coverUrl) {
    try {
      const coverResponse = await fetch(metadata.coverUrl);
      const coverBlob = await coverResponse.blob();
      zip.file('OEBPS/cover.jpg', coverBlob);
    } catch (error) {
      console.warn('Failed to add cover image:', error);
    }
  }

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