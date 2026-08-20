import { useEffect, useState } from "react";
import { Editor } from "./components/Editor";
import { PresenceList } from "./components/PresenceList";
import { SyncProvider } from "./realtime/sync-provider";

const DOCUMENT_ID = "t017-demo-document";

const websocketUrl = (): string => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:3000/ws`;
};

export function App() {
  const [provider, setProvider] = useState<SyncProvider | null>(null);

  useEffect(() => {
    const nextProvider = new SyncProvider(websocketUrl(), DOCUMENT_ID);
    nextProvider.awareness.setLocalStateField("user", {
      name: `Temporary user ${nextProvider.awareness.clientID}`,
      color: "#2563eb",
      colorLight: "#bfdbfe",
    });
    setProvider(nextProvider);
    return () => nextProvider.destroy();
  }, []);

  return (
    <main>
      <h1>CollabDocs</h1>
      <p>Shared plain-text document</p>
      {provider ? (
        <>
          <PresenceList awareness={provider.awareness} />
          <Editor provider={provider} />
        </>
      ) : (
        <p>Connecting…</p>
      )}
    </main>
  );
}
