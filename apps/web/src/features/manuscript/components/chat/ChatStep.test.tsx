import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatStep } from "./ChatStep";

const pages = [{ id: 42, page_index: 2, title: "The Door" }];

describe("page links in agent replies", () => {
  it("opens a live page beside the chat, using its stable id", () => {
    const jump = vi.fn();
    const { rerender } = render(<ChatStep step={{ t: "note", label: "See [p3 “The Door”](?page=42)." }} pages={pages} onJumpToPage={jump} canvas={{ kind: "page", pageId: 42 }} />);
    const link = screen.getByRole("link", { name: "p3 “The Door”" });
    expect(link).toHaveAttribute("aria-current", "page");
    fireEvent.click(link);
    expect(jump).toHaveBeenLastCalledWith(42);
    rerender(<ChatStep step={{ t: "note", label: "See [p3 “The Door”](?page=42)." }} pages={[{ ...pages[0], page_index: 4 }]} onJumpToPage={jump} />);
    fireEvent.click(screen.getByRole("link"));
    expect(jump).toHaveBeenLastCalledWith(42); // inserting a page cannot redirect an earlier link
  });

  it("leaves missing or invented page ids as readable text", () => {
    render(<ChatStep step={{ t: "note", label: "See [the missing page](?page=999) and [a bad link](?page=42&book=9)." }} pages={pages} onJumpToPage={vi.fn()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("the missing page")).toBeInTheDocument();
  });

  it("preserves modified clicks and external links", () => {
    const jump = vi.fn();
    render(<ChatStep step={{ t: "note", label: "[Page](?page=42), [source](https://example.com)." }} pages={pages} onJumpToPage={jump} />);
    fireEvent.click(screen.getByRole("link", { name: "Page" }), { ctrlKey: true });
    expect(jump).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "source" })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows the original canvas receipt after moving to another page", () => {
    const select = vi.fn();
    const step = { t: "user" as const, label: "Tighten this page", canvas: { target: { kind: "page" as const, pageId: 42 }, label: "p3 · The Door" } };
    const { rerender } = render(<ChatStep step={step} canvas={{ kind: "book" }} onSelectCanvas={select} canOpenCanvas={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "p3 · The Door" }));
    expect(select).toHaveBeenCalledWith({ kind: "page", pageId: 42 });
    rerender(<ChatStep step={step} canvas={{ kind: "book" }} onSelectCanvas={select} canOpenCanvas={() => false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("p3 · The Door")).toBeInTheDocument();
  });
});
