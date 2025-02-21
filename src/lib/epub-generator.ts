import { Database } from '@/integrations/supabase/types';

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
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    return await response.blob();
  } catch (error) {
    console.warn(`Failed to download image: ${url}`, error);
    return null;
  }
};

// Extract image URLs from HTML content
const extractImageUrls = (html: string): string[] => {
  if (!html) return [];
  const div = document.createElement('div');
  div.innerHTML = html;
  const images = div.querySelectorAll('img');
  return Array.from(images)
    .map(img => img.getAttribute('src'))
    .filter((src): src is string => src !== null && src.startsWith('http'));
};

export const prepareEPUBContent = async (
  pages: Page[]
): Promise<{
  processedPages: Page[];
  images: EPUBImage[];
}> => {
  // Process and download images
  const imagePromises = pages.flatMap(page => 
    extractImageUrls(page.html_content || '').map(async url => ({
      url,
      blob: await downloadImage(url)
    }))
  );

  const images = (await Promise.all(imagePromises))
    .filter(img => img.blob !== null)
    .map((img, index) => ({
      id: `img-${index}`,
      url: img.url,
      blob: img.blob as Blob
    }));

  // Create image map for replacement
  const imageMap = new Map(images.map(img => [img.url, img.id]));

  // Process pages and replace image URLs with IDs
  const processedPages = pages.map(page => ({
    ...page,
    html_content: page.html_content 
      ? processContent(page.html_content).replace(
          /<img[^>]+src="([^"]+)"[^>]*>/g,
          (match, url) => {
            const imgId = imageMap.get(url);
            return imgId 
              ? match.replace(url, `images/${imgId}`) 
              : match;
          }
        )
      : null,
    page_type: page.page_type as 'section' | 'page'
  }));

  return { processedPages, images };
};
