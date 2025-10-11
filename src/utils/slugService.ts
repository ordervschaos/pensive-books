/**
 * Utility functions for generating and parsing URL-friendly slugs
 */

export const SlugService = {
  /**
   * Extract numeric ID from a slug
   * @param param - URL parameter that might be "123" or "123-my-page-title"
   * @returns Numeric ID or 0 if not found
   */
  extractId: (param: string | undefined): number => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  },

  /**
   * Generate a URL-friendly slug from an ID and title
   * @param id - Numeric ID
   * @param title - Page or book title
   * @returns Slug in format "123-my-page-title"
   */
  generateSlug: (id: number, title: string): string => {
    if (!title) return id.toString();
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing dashes
    return `${id}-${slug}`;
  },

  /**
   * Check if a parameter already contains a slug (has a dash)
   * @param param - URL parameter
   * @returns true if param contains a dash
   */
  hasSlug: (param: string | undefined): boolean => {
    return param?.includes('-') ?? false;
  },
};
