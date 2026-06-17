// useChatScroll — gold-standard "stick to bottom" scroll hook shared by the studio chat rails.
//
// Behaviour:
//   - On first render: jumps instantly to the bottom (behavior:"auto") so no animation plays
//     through existing history.
//   - On subsequent content changes: smoothly scrolls to the bottom ONLY if the user is already
//     at/near the bottom (~48 px threshold). If the user has scrolled up to read, they are left
//     alone.
//   - scrollToBottom(smooth?) — imperative escape-hatch (e.g. "jump to latest" pill).
//   - atBottom — true when within threshold; used by the caller to show/hide the pill.
import { useCallback, useEffect, useRef, useState } from "react";

const THRESHOLD = 48; // px from bottom that counts as "at bottom"

export function useChatScroll(contentSignal: readonly unknown[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Have we performed the initial instant-anchor on REAL content yet? (Not just the first effect
  // tick — that fires at mount while the row is still empty, before any history has rendered.)
  const anchored = useRef(false);

  // Track atBottom via scroll listener.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distFromBottom <= THRESHOLD);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    // Run once to set initial state.
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // React to content changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Until we've anchored on real (overflowing) content, jump INSTANTLY — this covers both the
    // empty mount and the first time history loads, so it never animates through the backlog.
    if (!anchored.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      setAtBottom(true);
      if (el.scrollHeight - el.clientHeight > 0) anchored.current = true;
      return;
    }

    // Subsequent updates: only scroll if user is already at/near the bottom.
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom <= THRESHOLD) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, contentSignal);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  return { scrollRef, atBottom, scrollToBottom };
}
