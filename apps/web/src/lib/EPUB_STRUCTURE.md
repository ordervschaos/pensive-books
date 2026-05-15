# EPUB File Structure Documentation

## Overview

This document explains the EPUB file format structure and how the `epub.ts` generator creates compliant EPUB files.

## What is an EPUB?

An EPUB file is essentially a **ZIP archive** with a specific internal structure. It contains:
- XHTML content files (the book pages)
- Images and media
- CSS stylesheets
- Metadata and navigation files

## EPUB 3 File Structure

```
book.epub (ZIP archive)
│
├── mimetype                          # Must be first file, uncompressed
│                                     # Contains: "application/epub+zip"
│
├── META-INF/
│   └── container.xml                 # Bootstrap file that points to package document
│
└── OEBPS/                            # Main content directory (OEBPS = Open eBook Publication Structure)
    ├── package.opf                   # Package document: manifest, metadata, spine
    ├── toc.ncx                       # Legacy navigation (EPUB 2 compatibility)
    ├── nav.xhtml                     # HTML5 navigation (EPUB 3)
    │
    ├── content.xhtml                 # Main book content
    ├── styles.css                    # CSS stylesheets
    ├── cover.jpg                     # Cover image
    │
    └── images/                       # 📸 All content images stored here
        ├── img-0                     # Image files (JPEG, PNG, GIF, SVG)
        ├── img-1
        └── ...
```

## Key Components Explained

### 1. `mimetype` (Required)
- **Location**: Root of ZIP archive
- **Content**: Plain text string `"application/epub+zip"`
- **Requirements**:
  - MUST be the first file in the archive
  - MUST be stored uncompressed (`compression: 'STORE'`)
  - Enables e-readers to identify the file format via "magic numbers"

### 2. `META-INF/container.xml` (Required)
- **Purpose**: Bootstrap file that tells e-readers where to find the package document
- **Content**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
```

### 3. `OEBPS/content.opf` (Required - Package Document)
- **Purpose**: The "brain" of the EPUB - declares all resources and reading order
- **Contains three main sections**:

#### a) Metadata
```xml
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Book Title</dc:title>
  <dc:creator>Author Name</dc:creator>
  <dc:language>en</dc:language>
  <dc:identifier id="BookId">urn:uuid:12345</dc:identifier>
  <meta property="dcterms:modified">2025-10-24T00:00:00Z</meta>
</metadata>
```

#### b) Manifest (lists ALL resources)
```xml
<manifest>
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
  <item id="css" href="styles.css" media-type="text/css"/>
  <item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
  <item id="img-0" href="images/img-0" media-type="image/png"/>
  <item id="img-1" href="images/img-1" media-type="image/jpeg"/>
</manifest>
```

#### c) Spine (defines reading order)
```xml
<spine toc="ncx">
  <itemref idref="nav"/>
  <itemref idref="content"/>
</spine>
```

### 4. `OEBPS/nav.xhtml` (Required - EPUB 3)
- **Purpose**: HTML5 table of contents
- **Structure**:
```html
<nav epub:type="toc" id="toc">
  <h1>Table of Contents</h1>
  <ol>
    <li><a href="content.xhtml#page0">Chapter 1</a></li>
    <li><a href="content.xhtml#page1">Chapter 2</a></li>
  </ol>
</nav>
```

### 5. `OEBPS/toc.ncx` (Backward Compatibility)
- **Purpose**: Navigation file for older EPUB 2 readers
- **Format**: XML-based navigation structure

### 6. `OEBPS/content.xhtml` (Content)
- **Purpose**: Main book content in XHTML format
- **Requirements**:
  - Must be valid XHTML (XML-compliant HTML)
  - All tags must be properly closed (`<br/>` not `<br>`)
  - HTML entities must use numeric format (`&#160;` not `&nbsp;`)

### 7. `OEBPS/styles.css` (Styling)
- **Purpose**: CSS stylesheets for book formatting
- **Contains**: Typography, layout, page breaks, etc.

### 8. `OEBPS/images/` (Media Directory)
- **Purpose**: Storage for all content images
- **Supported Formats**: JPEG, PNG, GIF, SVG
- **Naming**: Generated IDs like `img-0`, `img-1`, etc.

## Image Handling in EPUB

### Where Images Are Stored
All content images are stored in the `OEBPS/images/` directory with generated IDs.

### Image Reference Flow
1. **In HTML content**: `<img src="../images/img-0" alt="Description"/>`
2. **In manifest**: `<item id="img-0" href="images/img-0" media-type="image/png"/>`

### Image Processing in epub.ts

#### Step 1: Extract Image URLs
```typescript
// From page content (TipTap JSON → HTML)
const htmlContent = convertJSONToHTML(page.content);
const imageUrls = extractImageUrls(htmlContent);
```

#### Step 2: Download Images
```typescript
// Download each image as a Blob
const images = await Promise.all(
  imageUrls.map(async (url, index) => ({
    id: `img-${index}`,
    url: url,
    blob: await downloadImage(url)
  }))
);
```

#### Step 3: Replace URLs in Content
```typescript
// Replace original URLs with local EPUB paths
imageMap.forEach((imageId, originalUrl) => {
  htmlContent = htmlContent.replace(originalUrl, `images/${imageId}`);
});
```

#### Step 4: Add to ZIP Archive
```typescript
// Add each image to the EPUB
for (const image of images) {
  zip.file(`OEBPS/images/${image.id}`, image.blob);
}
```

## Content Processing Pipeline

### TipTap JSON → EPUB XHTML

**Step 1: JSON to HTML Conversion**
```typescript
// Page content is stored as TipTap JSON in database
const htmlContent = convertJSONToHTML(page.content);
```

**Step 2: Image URL Replacement**
```typescript
// Replace external image URLs with local EPUB paths
htmlContent = htmlContent.replace(originalUrl, `images/${imageId}`);
```

**Step 3: Sanitize for XHTML Compliance**
```typescript
const xhtmlContent = sanitizeContent(htmlContent);
```

### Sanitization Requirements

EPUB requires XHTML (XML-compliant HTML), which means:

1. **Self-closing tags must have trailing slash**
   - ❌ `<br>` → ✅ `<br/>`
   - ❌ `<img src="...">` → ✅ `<img src="..."/>`
   - ❌ `<hr>` → ✅ `<hr/>`

2. **HTML entities must use numeric format**
   - ❌ `&nbsp;` → ✅ `&#160;`
   - ❌ `&mdash;` → ✅ `&#8212;`
   - ❌ `&ldquo;` → ✅ `&#8220;`

3. **Security-sensitive content removed**
   - Remove `<script>` tags
   - Remove `<style>` tags
   - Remove HTML comments

## Cover Image Generation

### Two Types of Covers

1. **With User-Provided Image**
   ```typescript
   // Load external image, draw on canvas, optionally overlay text
   const img = new Image();
   img.src = metadata.coverUrl;
   ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

   if (show_text_on_cover) {
     // Add semi-transparent overlay
     ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
     ctx.fillRect(0, 0, canvas.width, canvas.height);
     // Draw title, subtitle, author
   }
   ```

2. **Generated Cover (No Image)**
   ```typescript
   // Create gradient background
   const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
   gradient.addColorStop(0, '#1a3c5a');
   gradient.addColorStop(1, '#0f2439');
   ctx.fillStyle = gradient;
   ctx.fillRect(0, 0, canvas.width, canvas.height);
   // Always draw title, subtitle, author
   ```

### Cover Specifications
- **Dimensions**: 1600×2560 pixels (standard e-book ratio)
- **Format**: JPEG at 90% quality
- **File**: Stored as `OEBPS/cover.jpg`

## EPUB Generation Process

### Main Function: `generateEPUB()`

```typescript
export const generateEPUB = async (
  metadata: EPUBMetadata,
  pages: Page[],
  images: EPUBImage[],
  show_text_on_cover: boolean
): Promise<Blob>
```

### Step-by-Step Process

1. **Create ZIP Archive**
   ```typescript
   const zip = new JSZip();
   ```

2. **Add mimetype (uncompressed)**
   ```typescript
   zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
   ```

3. **Add META-INF/container.xml**
   ```typescript
   zip.file('META-INF/container.xml', generateContainerXml());
   ```

4. **Generate and Add Cover**
   ```typescript
   const coverBlob = await generateCoverImage(metadata, show_text_on_cover);
   zip.file('OEBPS/cover.jpg', coverBlob);
   ```

5. **Create Image Map**
   ```typescript
   const imageMap = new Map(images.map(img => [img.url, img.id]));
   ```

6. **Add OEBPS Files**
   ```typescript
   zip.file('OEBPS/content.opf', generateContentOpf(metadata, images));
   zip.file('OEBPS/nav.xhtml', generateNavXhtml(pages));
   zip.file('OEBPS/toc.ncx', generateTocNcx(metadata, pages));
   zip.file('OEBPS/content.xhtml', generateContentXhtml(metadata, pages, show_text_on_cover, imageMap));
   zip.file('OEBPS/styles.css', generateStyles());
   ```

7. **Add Content Images**
   ```typescript
   for (const image of images) {
     zip.file(`OEBPS/images/${image.id}`, image.blob);
   }
   ```

8. **Generate Final EPUB Blob**
   ```typescript
   return await zip.generateAsync({
     type: 'blob',
     mimeType: 'application/epub+zip',
     compression: 'DEFLATE',
     compressionOptions: { level: 9 }
   });
   ```

## EPUB Standards Compliance

### EPUB 3 Specification
- Follows EPUB 3.x standards
- Includes both EPUB 3 (nav.xhtml) and EPUB 2 (toc.ncx) navigation for compatibility
- Uses XHTML 5 for content files
- Proper namespaces and document types

### Validation
EPUB files can be validated using:
- [EPUBCheck](https://www.w3.org/publishing/epubcheck/) - Official EPUB validator
- [EPUB Validator](https://validator.idpf.org/) - Online validation

## File Organization Best Practices

### Why OEBPS?
- **OEBPS** = Open eBook Publication Structure (historical name)
- Not required by EPUB 3 spec, but widely used convention
- Alternative names: `EPUB/`, `Content/`, or any custom name
- Location referenced in `container.xml`

### Directory Structure Flexibility
The only fixed locations in EPUB are:
1. `mimetype` - MUST be at root
2. `META-INF/container.xml` - MUST be at this path

All other files can be organized however you want, as long as:
- They're declared in the manifest
- Paths are correctly referenced
- container.xml points to the package document

## Common EPUB Readers

### Desktop
- **Calibre** - Most popular, Windows/Mac/Linux
- **Apple Books** - macOS/iOS
- **Adobe Digital Editions** - Windows/Mac

### Mobile
- **Google Play Books** - Android
- **Apple Books** - iOS
- **Kindle** (via conversion to MOBI/AZW3)

### Web-based
- **Readium** - Chrome extension
- **EPUBReader** - Firefox extension

## Troubleshooting

### Common Issues

1. **Images not displaying**
   - Check manifest includes all images
   - Verify image paths in content.xhtml
   - Ensure images are in `OEBPS/images/` directory

2. **Invalid XHTML errors**
   - All tags must be closed: `<br/>` not `<br>`
   - Use numeric entities: `&#160;` not `&nbsp;`
   - No `<script>` or `<style>` tags in content

3. **Cover not showing**
   - Verify `cover.jpg` is in manifest
   - Check `properties="cover-image"` attribute
   - Ensure cover dimensions are reasonable (1600×2560 recommended)

4. **Table of contents broken**
   - Both `nav.xhtml` and `toc.ncx` must be present
   - Anchors must match: `#page0` in both files
   - All referenced pages must exist in content.xhtml

## References

- [EPUB 3 Specification](https://www.w3.org/TR/epub-33/)
- [IDPF EPUB 3 Best Practices](https://www.w3.org/publishing/epub3/epub-spec.html)
- [EPUBCheck Validation Tool](https://github.com/w3c/epubcheck)
- [EPUB File Format Overview](https://www.prepressure.com/library/file-formats/epub)

---

**Related Files:**
- `src/lib/epub.ts` - Main EPUB generator
- `src/lib/epub.test.ts` - Unit tests
- `supabase/functions/send-to-kindle/index.ts` - Kindle conversion service

**Last Updated:** October 2025
