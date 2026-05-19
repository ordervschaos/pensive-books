import { cn } from "../lib/cn";

export type BookCoverFallbackVariant = "tile" | "mini" | "hero";

export interface BookCoverFallbackProps {
  bookId?: number | string | null;
  title?: string | null;
  author?: string | null;
  variant?: BookCoverFallbackVariant;
  className?: string;
}

type CoverPalette = {
  bg: string;
  text: string;
};

const palettes: CoverPalette[] = [
  { bg: "#1f2d44", text: "#e8dcc4" },
  { bg: "#6b1f1f", text: "#f0e6d2" },
  { bg: "#2d4a3e", text: "#e8e2cc" },
  { bg: "#ebe1c8", text: "#2a2014" },
  { bg: "#1f1f1f", text: "#d6c4a3" },
  { bg: "#b8862d", text: "#2a1a08" },
  { bg: "#4a3157", text: "#e8d4c4" },
  { bg: "#a04b2c", text: "#f5e8d2" },
];

function getSeed(bookId?: number | string | null, title?: string | null) {
  return Array.from(`${bookId ?? ""}-${title ?? ""}`).reduce(
    (seed, char) => seed + char.charCodeAt(0),
    0,
  );
}

function getInitial(title?: string | null) {
  const match = title?.match(/[A-Za-z0-9]/);
  return match ? match[0].toUpperCase() : "P";
}

export function BookCoverFallback({
  bookId,
  title,
  author,
  variant = "tile",
  className,
}: BookCoverFallbackProps) {
  const palette = palettes[getSeed(bookId, title) % palettes.length];
  const safeTitle = (title ?? "").trim();
  const safeAuthor = (author ?? "").trim();

  if (variant === "mini") {
    return (
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center overflow-hidden",
          className,
        )}
        style={{ backgroundColor: palette.bg, color: palette.text }}
      >
        <span className="font-serif text-lg font-semibold leading-none">
          {getInitial(safeTitle)}
        </span>
      </div>
    );
  }

  const isHero = variant === "hero";

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col items-center justify-center overflow-hidden text-center",
        isHero ? "p-6" : "p-4",
        className,
      )}
      style={{ backgroundColor: palette.bg, color: palette.text }}
    >
      <h3
        className={cn(
          "break-words font-serif font-semibold leading-[1.15] tracking-tight",
          isHero ? "text-2xl line-clamp-6" : "text-base line-clamp-5 sm:text-lg",
        )}
        style={{ color: palette.text }}
      >
        {safeTitle || "Untitled"}
      </h3>
      {safeAuthor && (
        <p
          className={cn(
            "mt-2 line-clamp-1 break-words font-medium uppercase opacity-70",
            isHero
              ? "text-[11px] tracking-[0.2em]"
              : "text-[9px] tracking-[0.18em] sm:text-[10px]",
          )}
          style={{ color: palette.text }}
        >
          {safeAuthor}
        </p>
      )}
    </div>
  );
}
