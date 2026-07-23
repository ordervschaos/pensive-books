// Renders a compiled MDX doc. Each doc under ./content/*.mdx is compiled at build time by
// @mdx-js/rollup (see vite.config.ts) into a component whose default export IS the doc — registry.ts
// imports it directly (no runtime markdown parsing left). This wrapper supplies the shared element
// overrides via MDXProvider (mermaid fences, internal-link routing) and the Tailwind Typography
// (`prose`) styling every doc renders inside.
import type { ComponentType, ReactNode } from "react";
import { MDXProvider } from "@mdx-js/react";
import { Link } from "react-router-dom";
import { Mermaid } from "./Mermaid";

const components = {
  // ```mermaid fences (and any other fenced code) compile to <pre><code className="language-x">; a
  // bare `inline code span` compiles to a className-less <code> with no <pre> wrapper — the className
  // check is what tells them apart, exactly as the old react-markdown override did.
  code({ className, children, ...props }: { className?: string; children?: ReactNode }) {
    const match = /language-(\w+)/.exec(className ?? "");
    if (match?.[1] === "mermaid") {
      return <Mermaid code={String(children).replace(/\n$/, "")} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  // Internal doc links → SPA navigation via the router; external → new tab.
  a({ href, children, ...props }: { href?: string; children?: ReactNode }) {
    if (href?.startsWith("/")) {
      return <Link to={href}>{children}</Link>;
    }
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
        {children}
      </a>
    );
  },
};

export function MdxContent({ Content }: { Content: ComponentType }) {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-24 prose-pre:bg-muted prose-pre:text-foreground">
      <MDXProvider components={components}>
        <Content />
      </MDXProvider>
    </article>
  );
}
