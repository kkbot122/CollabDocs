import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import * as awareness from "y-protocols/awareness";
import * as Y from "yjs";
import { PresenceList } from "./PresenceList";

describe("PresenceList", () => {
  const resources: Array<{ awareness: awareness.Awareness; doc: Y.Doc }> = [];

  afterEach(() => {
    for (const resource of resources.splice(0)) {
      resource.awareness.destroy();
      resource.doc.destroy();
    }
  });

  const createAwareness = (): awareness.Awareness => {
    const doc = new Y.Doc();
    const state = new awareness.Awareness(doc);
    resources.push({ awareness: state, doc });
    return state;
  };

  it("renders each current Awareness state exactly once", () => {
    const state = createAwareness();
    state.setLocalState({ user: { name: "Temporary A", color: "#2563eb" } });

    const markup = renderToStaticMarkup(<PresenceList awareness={state} />);

    expect(markup.match(/Temporary A/g)).toHaveLength(1);
    expect(markup).toContain(`data-client-id="${state.clientID}"`);
  });

  it("reflects updates and removals when rendered from getStates", () => {
    const state = createAwareness();
    state.setLocalState({ user: { name: "Temporary A" } });

    expect(renderToStaticMarkup(<PresenceList awareness={state} />)).toContain(
      "Temporary A",
    );

    state.setLocalStateField("user", { name: "Temporary A updated" });
    expect(renderToStaticMarkup(<PresenceList awareness={state} />)).toContain(
      "Temporary A updated",
    );

    state.setLocalState(null);
    expect(renderToStaticMarkup(<PresenceList awareness={state} />)).toContain(
      "No other users are present.",
    );
  });
});
