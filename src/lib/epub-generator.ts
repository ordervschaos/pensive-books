import { Database } from '@/integrations/supabase/types';
import { convertJSONToHTML } from '@/utils/tiptapHelpers';

type Page = Database['public']['Tables']['pages']['Row'];

export interface EPUBImage {
  id: string;
  url: string;
  blob: Blob;
}

export interface EPUBOptions {
  title: string;
  subtitle?: string | null;
  author?: string | null;
  language?: string;
  coverUrl?: string | null;
  identifier?: string;
}

// Process HTML content for EPUB
const processContent = (html: string): string => {
  if (!html) return '';
  
  // Create a temporary div to parse HTML
  const div = document.createElement('div');
  div.innerHTML = html;
  
  // Process images
  div.querySelectorAll('img').forEach(img => {
    img.setAttribute('style', 'max-width: 100%; height: auto; page-break-inside: avoid; margin: 10px 0;');
    img.removeAttribute('class');
  });

  // Remove interactive elements
  div.querySelectorAll('button, script').forEach(el => el.remove());
  
  return div.innerHTML;
};

// Download and process images for EPUB
const downloadImage = async (url: string): Promise<Blob | null> => {
  try {
    console.log(`EPUB: Downloading image from ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    console.log(`EPUB: Successfully downloaded image (${blob.size} bytes, type: ${blob.type})`);
    return blob;
  } catch (error) {
    console.error(`EPUB: Failed to download image from ${url}:`, error);
    return null;
  }
};

// Extract image URLs from HTML content
const extractImageUrls = (html: string): string[] => {
  if (!html) return [];
  const div = document.createElement('div');
  div.innerHTML = html;
  const images = div.querySelectorAll('img');
  const urls = Array.from(images)
    .map(img => {
      const src = img.getAttribute('src');
      if (!src) return null;

      // Convert relative URLs to absolute URLs
      if (src.startsWith('/')) {
        const absoluteUrl = `${window.location.origin}${src}`;
        console.log(`EPUB: Converting relative URL ${src} to ${absoluteUrl}`);
        return absoluteUrl;
      }

      // Keep http/https URLs as-is
      if (src.startsWith('http://') || src.startsWith('https://')) {
        console.log(`EPUB: Found absolute URL ${src}`);
        return src;
      }

      // Skip data URLs and other non-fetchable URLs
      console.log(`EPUB: Skipping non-fetchable URL ${src}`);
      return null;
    })
    .filter((src): src is string => src !== null);

  console.log(`EPUB: Extracted ${urls.length} image URLs from HTML`);
  return urls;
};

export const prepareEPUBContent = async (
  pages: Page[]
): Promise<{
  processedPages: Page[];
  images: EPUBImage[];
}> => {
  // Process and download images
  const imagePromises = pages.flatMap((page, index) => {
    // Convert JSON content to HTML for image extraction
    const htmlContent = page.content ? convertJSONToHTML(page.content) : '';
    console.log(`EPUB: Page ${index} (${page.title || 'Untitled'}) - has JSON: ${!!page.content}, HTML length: ${htmlContent.length}`);

    const urls = extractImageUrls(htmlContent);
    console.log(`EPUB: Page ${index} - found ${urls.length} images`);

    return urls.map(async url => ({
      url,
      blob: await downloadImage(url)
    }));
  });

  const images = (await Promise.all(imagePromises))
    .filter(img => img.blob !== null)
    .map((img, index) => ({
      id: `img-${index}`,
      url: img.url,
      blob: img.blob as Blob
    }));

  console.log(`EPUB: Processed ${images.length} images for inclusion`);

  // Create image map for replacement
  const imageMap = new Map(images.map(img => [img.url, img.id]));

  // Process pages - no need to process HTML separately
  // The epub.ts will generate HTML from JSON directly
  const processedPages = pages.map(page => ({
    ...page,
    page_type: page.page_type as 'section' | 'page'
  }));

  return { processedPages, images };
};
