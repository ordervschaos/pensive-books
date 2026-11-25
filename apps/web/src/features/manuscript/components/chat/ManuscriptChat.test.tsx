import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManuscriptRunRow } from "../../lib/manuscriptAgent";
import { ManuscriptChat } from "./ManuscriptChat";

const mocks = vi.hoisted(() => ({ send: vi.fn(), answer: vi.fn(), toast: vi.fn(), scroll: vi.fn() }));
vi.mock("../../lib/manuscriptAgent", () => ({ sendManuscriptMessage: mocks.send, answerManuscriptAgent: mocks.answer }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/stopRun", () => ({ stopRun: vi.fn() }));
vi.mock("@/components/book/shared/useChatScroll", () => ({ useChatScroll: () => ({ scrollRef: { current: null }, atBottom: true, scrollToBottom: mocks.scroll }) }));
vi.mock("@/features/dna/lib/agentThread", () => ({
  fetchAgentSessionCount: async () => 0, fetchAgentSessions: async () => [], resumeAgentSession: vi.fn(), startNewAgentSession: vi.fn(),
}));

const page = { id: 42, page_index: 2, page_type: "text" as const, title: "The Door", content: null };
const base = () => ({
  bookId: 1, run: null, refetchRun: vi.fn(), stale: false, pages: [page], staged: [], busyId: null,
  canvas: { kind: "page" as const, pageId: 42 }, onSelectCanvas: vi.fn(),
  onAccept: vi.fn(), onReject: vi.fn(), onJumpToChange: vi.fn(), onJumpToPage: vi.fn(), onAction: vi.fn(),
});

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.send.mockResolvedValue(undefined); mocks.answer.mockResolvedValue(undefined); });

describe("manuscript chat context", () => {
  it("fills a page-specific starter for editing before sending", async () => {
    render(<ManuscriptChat {...base()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tighten the prose" }));
    const input = screen.getByRole("textbox", { name: "Message the manuscript agent" });
    expect((input as HTMLTextAreaElement).value).toContain("Tighten this page");
    expect(input).toHaveFocus();
    expect(mocks.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(1, expect.stringContaining("Tighten this page"), "default", { kind: "page", pageId: 42 }));
  });

  it("keeps the optimistic receipt on the sent page as the canvas moves", async () => {
    const props = base();
    const { rerender } = render(<ManuscriptChat {...props} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Tighten this page" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(props.refetchRun).toHaveBeenCalled());
    rerender(<ManuscriptChat {...props} canvas={{ kind: "book" }} />);
    expect(screen.getByText("Book details")).toBeInTheDocument();
    expect(screen.getByText("p3 · The Door")).toBeInTheDocument();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][3]).toEqual({ kind: "page", pageId: 42 });
  });

  it("sends canvas context with an answer to a parked question too", async () => {
    const run = { id: 7, status: "awaiting_input", steps: [], pending: { question: "Which voice?", options: ["Keep it quiet"] } } as ManuscriptRunRow;
    render(<ManuscriptChat {...base()} run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep it quiet" }));
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledWith(7, "Keep it quiet", { kind: "page", pageId: 42 }));
  });

  it("restores a failed message and keeps it ready to retry", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Offline"));
    render(<ManuscriptChat {...base()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep my voice" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Keep my voice"));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Offline" }));
    expect(screen.queryByText("Keep my voice", { selector: "div.whitespace-pre-wrap" })).not.toBeInTheDocument();
  });

  it("does not mistake an earlier identical message for the new optimistic echo", async () => {
    const run = { id: 7, status: "done", steps: [{ t: "user", label: "Again" }] } as ManuscriptRunRow;
    render(<ManuscriptChat {...base()} run={run} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    expect(screen.getAllByText("Again")).toHaveLength(2);
  });

  it("keeps Enter available to an input method composing a word", () => {
    render(<ManuscriptChat {...base()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "日本語" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
