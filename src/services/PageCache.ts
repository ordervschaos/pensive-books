interface Page {
  id: number;
  title: string;
  html_content: string;
  page_index: number;
  book_id: number;
  archived: boolean;
}

interface Book {
  id: number;
  name: string;
  is_archived: boolean;
}

interface CachedPage {
  page: Page;
  book: Book;
  timestamp: number;
}

class PageCache {
  private cache: Map<string, CachedPage> = new Map();
  private maxSize: number = 10; // Maximum number of pages to cache
  private maxAge: number = 5 * 60 * 1000; // 5 minutes in milliseconds

  constructor(maxSize: number = 10, maxAge: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.maxAge = maxAge;
  }

  // Generate a cache key from bookId and pageId
  private getCacheKey(bookId: number, pageId: number): string {
    return `${bookId}-${pageId}`;
  }

  // Add a page to the cache
  set(bookId: number, pageId: number, page: Page, book: Book): void {
    const key = this.getCacheKey(bookId, pageId);
    
    // If cache is full, remove oldest entry
    if (this.cache.size >= this.maxSize) {
      this.removeOldest();
    }
    
    this.cache.set(key, {
      page,
      book,
      timestamp: Date.now()
    });
  }

  // Get a page from the cache
  get(bookId: number, pageId: number): CachedPage | null {
    const key = this.getCacheKey(bookId, pageId);
    const cached = this.cache.get(key);
    
    if (!cached) return null;
    
    // Check if cache entry is too old
    if (Date.now() - cached.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }
    
    return cached;
  }

  // Remove the oldest cache entry
  private removeOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, value] of this.cache.entries()) {
      if (value.timestamp < oldestTime) {
        oldestTime = value.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  // Clear the entire cache
  clear(): void {
    this.cache.clear();
  }
}

// Export a singleton instance
export const pageCache = new PageCache(); 