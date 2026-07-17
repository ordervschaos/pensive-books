// The docs registry: the single hand-maintained list of documents in the /docs store. Content is
// authored as plain .md under ./content and imported raw (Vite `?raw`), so a doc is edited as
// markdown with no code change. To add a doc: drop a .md in ./content, import it, add a row here.
// (Order here IS the sidebar order.) MVP is markdown-only; the clean upgrade path is MDX — rename to
// .mdx + add @mdx-js/rollup, and this registry/layout/routing don't change.
import overview from "./content/overview.md?raw";
import howItWorks from "./content/how-it-works.md?raw";
import theAgent from "./content/the-agent.md?raw";

export type Doc = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  content: string;
};

export const DOCS: Doc[] = [
  {
    slug: "overview",
    title: "What Pensive Is",
    summary: "The product in one page — the bet, the audience, and the bar for success.",
    category: "Start here",
    content: overview,
  },
  {
    slug: "how-it-works",
    title: "How It Works — the DNA Method",
    summary: "Structure-first: the seed→prose ladder and why the book is a render of its tree.",
    category: "The method",
    content: howItWorks,
  },
  {
    slug: "the-agent",
    title: "The AI Editor Agent",
    summary: "The one AI collaborator that proposes changes and never touches the manuscript without you.",
    category: "The method",
    content: theAgent,
  },
];

export const getDoc = (slug: string): Doc | undefined => DOCS.find((d) => d.slug === slug);

// Docs grouped by category, preserving registry order — for the sidebar / index.
export function docsByCategory(): { category: string; docs: Doc[] }[] {
  const groups: { category: string; docs: Doc[] }[] = [];
  for (const doc of DOCS) {
    let g = groups.find((x) => x.category === doc.category);
    if (!g) {
      g = { category: doc.category, docs: [] };
      groups.push(g);
    }
    g.docs.push(doc);
  }
  return groups;
}
