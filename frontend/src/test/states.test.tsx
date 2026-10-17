import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import { DataView, ErrorState } from "@/components/fr/states";

beforeEach(() => window.localStorage.setItem("1000h.locale", "en"));
afterEach(cleanup);

it.each([404, 405])("shows 'not available' without Retry for HTTP %i", (status) => {
  render(<ErrorState error={new ApiError(status, "nope")} retry={() => {}} />);
  expect(screen.getByText("Not available on this server yet")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
});

it("shows the not-available state in Chinese by default", () => {
  window.localStorage.removeItem("1000h.locale");
  render(<ErrorState error={new ApiError(404, "nope")} />);
  expect(screen.getByText("此功能的后端尚未上线")).toBeInTheDocument();
});

it("keeps the normal error with Retry for a 500", () => {
  const retry = vi.fn();
  render(<ErrorState error={new ApiError(500, "boom")} retry={retry} />);
  expect(screen.getByText("boom")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /try again/i }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it("keeps the normal error for a network failure (status 0)", () => {
  render(<ErrorState error={new ApiError(0, "Network error")} retry={() => {}} />);
  expect(screen.getByText("Network error")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
});

it("DataView renders the not-available state for a 404 query", () => {
  render(
    <DataView
      query={{
        isPending: false,
        isError: true,
        error: new ApiError(404, "x"),
        data: undefined,
        refetch: () => {},
      }}
    >
      {() => <p>content</p>}
    </DataView>,
  );
  expect(screen.getByText("Not available on this server yet")).toBeInTheDocument();
  expect(screen.queryByText("content")).toBeNull();
});

it("quiet DataView hides an optional panel when the server lacks the route", () => {
  const { container } = render(
    <DataView
      quiet
      query={{
        isPending: false,
        isError: true,
        error: new ApiError(404, "x"),
        data: undefined,
        refetch: () => {},
      }}
    >
      {() => <p>content</p>}
    </DataView>,
  );
  expect(container).toBeEmptyDOMElement();
});

it("quiet DataView still reports real errors", () => {
  render(
    <DataView
      quiet
      query={{
        isPending: false,
        isError: true,
        error: new ApiError(500, "boom"),
        data: undefined,
        refetch: () => {},
      }}
    >
      {() => <p>content</p>}
    </DataView>,
  );
  expect(screen.getByText("boom")).toBeInTheDocument();
});
