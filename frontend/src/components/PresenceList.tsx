import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";

interface PresenceListProps {
  readonly awareness: Awareness;
}

export function PresenceList({ awareness }: PresenceListProps) {
  const [, rerender] = useState(0);

  useEffect(() => {
    const handleChange = (): void => {
      rerender((value) => value + 1);
    };

    awareness.on("change", handleChange);
    return () => awareness.off("change", handleChange);
  }, [awareness]);

  const states = [...awareness.getStates().entries()];

  return (
    <section aria-label="Present users">
      <h2>Present users</h2>
      {states.length === 0 ? (
        <p>No other users are present.</p>
      ) : (
        <ul>
          {states.map(([clientId, state]) => {
            const user = state.user as
              | { name?: string; color?: string }
              | undefined;
            const name = user?.name ?? `Temporary user ${clientId}`;
            const color = user?.color ?? "#2563eb";

            return (
              <li key={clientId} data-client-id={clientId}>
                <span
                  aria-hidden="true"
                  style={{
                    backgroundColor: color,
                    borderRadius: "50%",
                    display: "inline-block",
                    height: "0.75rem",
                    marginRight: "0.4rem",
                    width: "0.75rem",
                  }}
                />
                {name}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
