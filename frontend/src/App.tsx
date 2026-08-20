import { useEffect, useState } from "react";
import { Editor } from "./components/Editor";
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
    setProvider(nextProvider);
    return () => nextProvider.destroy();
  }, []);

  return (
    <main>
      <h1>CollabDocs</h1>
      <p>Shared plain-text document</p>
      {provider ? <Editor provider={provider} /> : <p>Connecting…</p>}
    </main>
  );
}
