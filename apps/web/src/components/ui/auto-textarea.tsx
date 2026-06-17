import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// A textarea that grows to fit its content — long text wraps and stays fully readable instead of
// clipping to one line. Works both controlled (value/onChange) and uncontrolled (defaultValue):
// it sizes on every input event and after each render, so the first paint already fits the content.
export function AutoTextarea({ className, onInput, ...props }: ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    // Find nearest scrolling ancestor so we can restore its position after height="auto"
    // temporarily collapses the element (which would otherwise jump the scroll to top).
    let scrollParent: Element | null = el.parentElement;
    while (scrollParent && scrollParent !== document.documentElement) {
      const { overflow, overflowY } = getComputedStyle(scrollParent);
      if (/auto|scroll/.test(overflow + overflowY)) break;
      scrollParent = scrollParent.parentElement;
    }
    const savedTop = scrollParent ? scrollParent.scrollTop : window.scrollY;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (scrollParent) scrollParent.scrollTop = savedTop;
    else window.scrollTo(0, savedTop);
  };

  useLayoutEffect(() => { fit(ref.current); });

  return (
    <Textarea
      ref={ref}
      rows={1}
      onInput={(e) => { fit(e.currentTarget); onInput?.(e); }}
      className={cn("min-h-0 resize-none overflow-hidden", className)}
      {...props}
    />
  );
}
