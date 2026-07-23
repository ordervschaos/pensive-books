// The docs registry: the single hand-maintained list of documents in the /docs store. Content is
// authored as .mdx under ./content — @mdx-js/rollup (vite.config.ts) compiles each file at build
// time into a component, so `content` below IS the doc, not a string to parse at render time. A doc
// can freely mix markdown with real JSX (raw HTML tags like <details>, imported components) — plain
// markdown still "just works" since MDX is a superset. To add a doc: drop a .mdx in ./content,
// import its default export, add a row here. (Order here IS the sidebar order.)
import Overview from "./content/overview.mdx";
import HowItWorks from "./content/how-it-works.mdx";
import TheAgent from "./content/the-agent.mdx";
import AgentInternals from "./content/agent-internals.mdx";
import AgentTreeDoc from "./content/agent-tree.mdx";
import type { ComponentType } from "react";

export type Doc = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  content: ComponentType;
};

export const DOCS: Doc[] = [
  {
    slug: "overview",
    title: "What Pensive Is",
    summary: "The product in one page — the bet, the audience, and the bar for success.",
    category: "Start here",
    content: Overview,
  },
  {
    slug: "how-it-works",
    title: "How It Works — the DNA Method",
    summary: "Structure-first: the seed→prose ladder and why the book is a render of its tree.",
    category: "The method",
    content: HowItWorks,
  },
  {
    slug: "the-agent",
    title: "The AI Editor Agent",
    summary: "The one AI collaborator that proposes changes and never touches the manuscript without you.",
    category: "The method",
    content: TheAgent,
  },
  {
    slug: "agent-internals",
    title: "Inside the Agent — a Builder's Tour",
    summary: "The agent as an engineering artifact — durable loop, staged writes, context assembly — with the story domain abstracted away.",
    category: "Under the hood",
    content: AgentInternals,
  },
  {
    slug: "agent-tree",
    title: "The Agent, as a Tree",
    summary: "The same architecture as a collapsible, self-similar Q&A tree — read to any depth for a coherent picture at that altitude.",
    category: "Under the hood",
    content: AgentTreeDoc,
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
