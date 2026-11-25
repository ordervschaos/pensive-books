import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkGroup } from "./WorkGroup";

const steps = [{ t: "read" as const, label: "read p3 \"Door\"" }, { t: "read" as const, label: "searched “Ann” — 2 matches on 1 page" }];

describe("WorkGroup", () => {
  it("shows the latest action while live, and a summary once done", () => {
    const { rerender } = render(<WorkGroup steps={steps} live />);
    expect(screen.getByText(/Searched “Ann”/)).toBeInTheDocument();
    rerender(<WorkGroup steps={steps} live={false} />);
    expect(screen.getByText("Worked · read 1 page · 1 search")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/read p3/)).toBeInTheDocument();
  });
});
