import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { yCollab } from "y-codemirror.next";
import type { SyncProvider } from "../realtime/sync-provider";

interface EditorProps {
  readonly provider: SyncProvider;
}

export function Editor({ provider }: EditorProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) {
      return undefined;
    }

    const ytext = provider.doc.getText("content");
    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        basicSetup,
        // Awareness is intentionally omitted until T018. Passing null keeps
        // yCollab's document-sync plugin while disabling cursor decorations.
        yCollab(ytext, null, { undoManager: false }),
      ],
    });
    const view = new EditorView({ state, parent });

    return () => view.destroy();
  }, [provider]);

  return <div ref={parentRef} aria-label="Collaborative document" />;
}
