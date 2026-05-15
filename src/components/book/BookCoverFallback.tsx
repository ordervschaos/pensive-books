import { cn } from "@/lib/utils";

interface BookCoverFallbackProps {
  bookId?: number | string | null;
  title?: string | null;
  variant?: "tile" | "mini" | "hero";
  className?: string;
}

const gradientVariants = [
  "from-primary/90 via-primary/70 to-accent/70",
  "from-primary/80 via-secondary/90 to-accent/60",
  "from-secondary via-accent/70 to-primary/65",
  "from-muted via-secondary/80 to-primary/60",
];

const glyphContainerVariants = {
  tile: "h-16 w-16",
  mini: "h-9 w-9",
  hero: "h-20 w-20",
};

const glyphVariants = {
  tile: "text-4xl",
  mini: "text-lg",
  hero: "text-5xl",
};

const getSeed = (bookId?: number | string | null, title?: string | null) => {
  return Array.from(`${bookId ?? ""}-${title ?? ""}`).reduce(
    (seed, char) => seed + char.charCodeAt(0),
    0
  );
};

const getGlyph = (title?: string | null) => {
  const match = title?.match(/[A-Za-z0-9]/);
  return match ? match[0].toUpperCase() : "P";
};

export const BookCoverFallback = ({
  bookId,
  title,
  variant = "tile",
  className,
}: BookCoverFallbackProps) => {
  const gradient = gradientVariants[getSeed(bookId, title) % gradientVariants.length];
  const glyph = getGlyph(title);

  return (
    <div
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br",
        gradient,
        className
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-background/25 via-background/5 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-br from-background/20 via-transparent to-background/10" />
      <div
        className={cn(
          "relative flex items-center justify-center rounded-full border border-border/50 bg-background/35 shadow-sm backdrop-blur-sm",
          glyphContainerVariants[variant]
        )}
      >
        <span
          className={cn(
            "font-semibold uppercase leading-none text-foreground",
            glyphVariants[variant]
          )}
        >
          {glyph}
        </span>
      </div>
    </div>
  );
};
