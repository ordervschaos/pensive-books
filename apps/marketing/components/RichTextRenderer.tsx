import type { ReactNode } from "react";
import { slugifyIdTitle } from "@/lib/pensive";

type RichTextMark = {
  type?: string;
  attrs?: Record<string, unknown>;
};

type RichTextNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: RichTextMark[];
  content?: RichTextNode[];
};

type Props = {
  content: unknown;
  bookId: number;
  bookSlug: string;
  centerContent?: boolean;
};

type RenderContext = {
  bookId: number;
  bookSlug: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseContent(value: unknown): RichTextNode | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? (parsed as RichTextNode) : null;
    } catch (error) {
      console.error("Failed to parse published page content:", error);
      return null;
    }
  }

  return isRecord(value) ? (value as RichTextNode) : null;
}

function getTextContent(node: RichTextNode | undefined): string {
  if (!node) {
    return "";
  }

  if (node.type === "text") {
    return node.text || "";
  }

  return (node.content || []).map(getTextContent).join("");
}

function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }

  if (
    raw.startsWith("/") ||
    raw.startsWith("#") ||
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("mailto:") ||
    raw.startsWith("tel:")
  ) {
    return raw;
  }

  return null;
}

function safeImageSrc(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }

  if (
    raw.startsWith("/") ||
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("data:image/")
  ) {
    return raw;
  }

  return null;
}

function renderChildren(
  nodes: RichTextNode[] | undefined,
  context: RenderContext,
  keyPrefix: string,
): ReactNode {
  return (nodes || []).map((node, index) =>
    renderNode(node, context, `${keyPrefix}-${index}`),
  );
}

function applyMarks(
  content: ReactNode,
  marks: RichTextMark[] | undefined,
  context: RenderContext,
  keyPrefix: string,
): ReactNode {
  return (marks || []).reduce<ReactNode>((acc, mark, index) => {
    const key = `${keyPrefix}-mark-${index}`;

    switch (mark.type) {
      case "bold":
        return <strong key={key}>{acc}</strong>;
      case "italic":
        return <em key={key}>{acc}</em>;
      case "strike":
        return <s key={key}>{acc}</s>;
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
          >
            {acc}
          </code>
        );
      case "link": {
        const href = safeHref(mark.attrs?.href);
        if (!href) {
          return acc;
        }

        const isExternal =
          href.startsWith("http://") ||
          href.startsWith("https://") ||
          href.startsWith("mailto:") ||
          href.startsWith("tel:");

        return (
          <a
            key={key}
            href={href}
            className="text-primary underline underline-offset-4"
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noreferrer" : undefined}
          >
            {acc}
          </a>
        );
      }
      case "pageLink": {
        const pageId = String(mark.attrs?.pageId || "");
        const linkedBookId = String(mark.attrs?.bookId || context.bookId);
        const title = String(mark.attrs?.title || "");
        const broken = mark.attrs?.broken === true;

        if (broken || !pageId) {
          return (
            <span
              key={key}
              className="inline-flex rounded-full bg-destructive/10 px-2 py-0.5 text-sm text-destructive/70 line-through"
            >
              {acc}
            </span>
          );
        }

        const bookSlug =
          Number.parseInt(linkedBookId, 10) === context.bookId
            ? context.bookSlug
            : linkedBookId;

        const href = `/library/books/${bookSlug}/pages/${slugifyIdTitle(
          Number.parseInt(pageId, 10),
          title,
        )}`;

        return (
          <a
            key={key}
            href={href}
            className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary no-underline transition-colors hover:bg-primary/20"
          >
            {acc}
          </a>
        );
      }
      default:
        return acc;
    }
  }, content);
}

function renderNode(
  node: RichTextNode,
  context: RenderContext,
  key: string,
): ReactNode {
  const children = renderChildren(node.content, context, key);

  switch (node.type) {
    case "doc":
      return <>{children}</>;
    case "paragraph":
      return (
        <p key={key} className="mb-6 text-lg leading-relaxed md:text-xl">
          {children}
        </p>
      );
    case "heading": {
      const level =
        typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      const text = getTextContent(node);
      const id =
        typeof node.attrs?.id === "string" && node.attrs.id
          ? node.attrs.id
          : text
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
      const className =
        level === 1
          ? "mb-8 mt-0 text-4xl font-bold tracking-tight"
          : level === 2
            ? "mb-6 mt-8 text-3xl font-bold tracking-tight"
            : level === 3
              ? "mb-4 mt-6 text-2xl font-bold tracking-tight"
              : "mb-4 mt-6 text-xl font-bold tracking-tight";

      if (level === 1) {
        return (
          <h1 key={key} id={id} className={className}>
            {children}
          </h1>
        );
      }

      if (level === 2) {
        return (
          <h2 key={key} id={id} className={className}>
            {children}
          </h2>
        );
      }

      if (level === 3) {
        return (
          <h3 key={key} id={id} className={className}>
            {children}
          </h3>
        );
      }

      if (level === 4) {
        return (
          <h4 key={key} id={id} className={className}>
            {children}
          </h4>
        );
      }

      if (level === 5) {
        return (
          <h5 key={key} id={id} className={className}>
            {children}
          </h5>
        );
      }

      return (
        <h6 key={key} id={id} className="mb-4 mt-6 text-base font-bold tracking-tight">
          {children}
        </h6>
      );
    }
    case "bulletList":
      return (
        <ul key={key} className="mb-6 list-disc space-y-2 pl-6 text-lg md:text-xl">
          {children}
        </ul>
      );
    case "orderedList": {
      const start =
        typeof node.attrs?.start === "number" && node.attrs.start > 1
          ? node.attrs.start
          : undefined;

      return (
        <ol
          key={key}
          start={start}
          className="mb-6 list-decimal space-y-2 pl-6 text-lg md:text-xl"
        >
          {children}
        </ol>
      );
    }
    case "listItem":
      return (
        <li key={key} className="pl-1">
          {children}
        </li>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="my-6 border-l-4 border-primary pl-4 italic text-muted-foreground"
        >
          {children}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre
          key={key}
          className="my-6 overflow-x-auto rounded-lg bg-muted p-4 text-sm"
        >
          <code>{getTextContent(node)}</code>
        </pre>
      );
    case "hardBreak":
      return <br key={key} />;
    case "horizontalRule":
      return <hr key={key} className="my-10 border-border" />;
    case "image": {
      const src = safeImageSrc(node.attrs?.src);
      if (!src) {
        return null;
      }

      const alt =
        typeof node.attrs?.alt === "string" ? node.attrs.alt : "Page image";

      return (
        <img
          key={key}
          src={src}
          alt={alt}
          className="my-8 mx-auto block h-auto max-w-full rounded-lg"
        />
      );
    }
    case "table":
      return (
        <div key={key} className="my-6 overflow-x-auto">
          <table className="w-full border-collapse text-left">{children}</table>
        </div>
      );
    case "tableRow":
      return <tr key={key} className="border-b border-border">{children}</tr>;
    case "tableHeader":
      return (
        <th key={key} className="border border-border bg-muted px-3 py-2 font-semibold">
          {children}
        </th>
      );
    case "tableCell":
      return (
        <td key={key} className="border border-border px-3 py-2 align-top">
          {children}
        </td>
      );
    case "text":
      return (
        <span key={key}>
          {applyMarks(node.text || "", node.marks, context, key)}
        </span>
      );
    default:
      if (node.text) {
        return (
          <span key={key}>
            {applyMarks(node.text, node.marks, context, key)}
          </span>
        );
      }

      return <div key={key}>{children}</div>;
  }
}

export function RichTextRenderer({
  content,
  bookId,
  bookSlug,
  centerContent = false,
}: Props) {
  const parsed = parseContent(content);

  if (!parsed) {
    return <p className="text-muted-foreground">No content available.</p>;
  }

  return (
    <div
      className={`flex min-h-[50vh] flex-col ${centerContent ? "justify-center" : ""}`}
    >
      <div
        className={`mx-auto w-full max-w-4xl ${centerContent ? "text-center" : ""}`}
      >
        {renderNode(parsed, { bookId, bookSlug }, "root")}
      </div>
    </div>
  );
}
