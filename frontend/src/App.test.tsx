import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the accessible CollabDocs heading", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("<h1>CollabDocs</h1>");
    expect(markup).toContain("Shared plain-text document");
  });
});
