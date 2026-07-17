// The docs markdown renderer: react-markdown + remark-gfm (both already deps), with two additions —
// ```mermaid fences route to the lazy Mermaid component, and internal /docs links use the router so
// navigation stays a SPA transition. Everything else is Tailwind Typography (`prose`).
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";
import { Mermaid } from "./Mermaid";

export function Markdown({ content }: { content: string }) {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-24 prose-pre:bg-muted prose-pre:text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
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
          a({ href, children, ...props }) {
            // Internal doc links → SPA navigation; external → new tab.
            if (href?.startsWith("/")) {
              return <Link to={href}>{children}</Link>;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
