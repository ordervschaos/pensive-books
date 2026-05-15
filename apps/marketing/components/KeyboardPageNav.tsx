"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type Props = {
  prevHref: string | null;
  nextHref: string | null;
};

export function KeyboardPageNav({ prevHref, nextHref }: Props) {
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      if (e.key === "ArrowLeft" && prevHref) {
        router.push(prevHref);
      } else if (e.key === "ArrowRight" && nextHref) {
        router.push(nextHref);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [prevHref, nextHref, router]);

  return null;
}
