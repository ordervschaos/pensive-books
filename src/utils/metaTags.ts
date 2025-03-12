/**
 * Utility functions for managing Open Graph meta tags
 */

/**
 * Validates Open Graph meta tags on the current page
 * This is useful for debugging purposes
 */
export const validateOpenGraphTags = (): { valid: boolean; missing: string[] } => {
  const requiredTags = [
    'og:title',
    'og:description',
    'og:image',
    'og:url',
    'og:type'
  ];
  
  const missingTags: string[] = [];
  
  requiredTags.forEach(tag => {
    const metaTag = document.querySelector(`meta[property="${tag}"]`);
    if (!metaTag) {
      missingTags.push(tag);
    }
  });
  
  return {
    valid: missingTags.length === 0,
    missing: missingTags
  };
};

/**
 * Gets the current Open Graph meta tags as an object
 * This is useful for debugging purposes
 */
export const getOpenGraphTags = (): Record<string, string> => {
  const ogTags = document.querySelectorAll('meta[property^="og:"]');
  const result: Record<string, string> = {};
  
  ogTags.forEach(tag => {
    const property = tag.getAttribute('property');
    const content = tag.getAttribute('content');
    
    if (property && content) {
      result[property] = content;
    }
  });
  
  return result;
}; 