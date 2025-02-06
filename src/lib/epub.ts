import JSZip from 'jszip';

interface Page {
  title: string | null;
  html_content: string | null;
  page_type: 'section' | 'page';
  page_index: number;
}

interface EPUBMetadata {
  title: string;
  author?: string | null;
  language?: string;
  identifier?: string;
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
export const generateContentOpf = (metadata: EPUBMetadata): string => `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    ${metadata.author ? `<dc:creator>${escapeXml(metadata.author)}</dc:creator>` : ''}
    <dc:language>${metadata.language || 'en'}</dc:language>
    <dc:identifier id="BookId">urn:uuid:${metadata.identifier || crypto.randomUUID()}</dc:identifier>
    <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="content"/>
  </spine>
</package>`;

// Generate nav.xhtml content
export const generateNavXhtml = (pages: Page[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <title>Navigation</title>
  <meta charset="UTF-8"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
      ${pages.map((page, index) => `
        <li><a href="content.xhtml#page${index}">${escapeXml(page.title || 'Untitled')}</a></li>
      `).join('\n')}
    </ol>
  </nav>
</body>
</html>`;

// Generate content.xhtml content
export const generateContentXhtml = (metadata: EPUBMetadata, pages: Page[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <title>${escapeXml(metadata.title)}</title>
  <meta charset="UTF-8"/>
</head>
<body>
  <h1>${escapeXml(metadata.title)}</h1>
  ${metadata.author ? `<h2>by ${escapeXml(metadata.author)}</h2>` : ''}
  ${pages.map((page, index) => `
    <section id="page${index}" epub:type="chapter">
      ${page.page_type === 'section' 
        ? `<h2>${escapeXml(page.title || 'Untitled Section')}</h2>`
        : `
          <article>
            <h3>${escapeXml(page.title || 'Untitled Page')}</h3>
            ${page.html_content ? sanitizeContent(page.html_content) : ''}
          </article>
        `}
    </section>
  `).join('\n')}
</body>
</html>`;

// Generate EPUB file
export const generateEPUB = async (
  metadata: EPUBMetadata,
  pages: Page[]
): Promise<Blob> => {
  const zip = new JSZip();

  // Add mimetype file first (must be uncompressed)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // Add META-INF directory
  zip.file('META-INF/container.xml', generateContainerXml());

  // Add OEBPS directory
  zip.file('OEBPS/content.opf', generateContentOpf(metadata));
  zip.file('OEBPS/nav.xhtml', generateNavXhtml(pages));
  zip.file('OEBPS/content.xhtml', generateContentXhtml(metadata, pages));

  // Generate the EPUB file
  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
}; 