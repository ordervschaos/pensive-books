// Resolve references only against live pages in this book. The model never chooses a route.
export interface LinkedPage { id: number; page_index: number; title: string | null }

export function pageFromHref(href: string | undefined, pages: LinkedPage[]): LinkedPage | undefined {
  const match = href?.match(/^\?page=([1-9]\d*)$/);
  return match ? pages.find((p) => p.id === Number(match[1])) : undefined;
}
