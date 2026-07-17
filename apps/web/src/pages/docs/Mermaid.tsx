// Lazy mermaid renderer for the docs store. Mermaid is heavy (~500KB), so it's dynamically imported
// only when a doc actually contains a ```mermaid fence — the whole /docs route is lazy already, and
// this defers the mermaid bundle further to the first diagram. Re-renders on theme-mode change so
// diagrams follow light/dark.
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";

let seq = 0;

export function Mermaid({ code }: { code: string }) {
  const { themeMode } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${seq++}`;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: themeMode === "dark" ? "dark" : "neutral",
          // Do NOT set fontFamily: "inherit". Mermaid measures each label's width in a detached
          // element (which can't inherit the app's font) but renders it in the real, wider monospace
          // font — so nodes get sized too narrow and clip the last characters ("seed"→"see"). Leaving
          // fontFamily unset keeps measurement and rendering in mermaid's own font, so widths match.
          flowchart: { useMaxWidth: true },
        });
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, themeMode]);

  if (error) {
    // Never blow up a doc over a bad diagram — show the source so the author can fix it.
    return (
      <pre className="overflow-x-auto rounded-md border border-destructive/40 bg-destructive/5 p-4 text-xs text-destructive">
        {`Diagram failed to render: ${error}\n\n${code}`}
      </pre>
    );
  }
  return <div ref={ref} className="my-6 flex justify-center overflow-x-auto [&_svg]:max-w-full" />;
}
