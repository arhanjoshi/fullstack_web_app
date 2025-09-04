import React from "react";
import { createConnectTransport } from "@connectrpc/connect-web";
import { createPromiseClient } from "@connectrpc/connect";
import { PriceService, PriceUpdate } from "@pluto/proto";

type TickerState = {
  price?: number;
  isoTime?: string;
  status: "connecting" | "streaming" | "error" | "stopped";
  error?: string;
};

const transport = createConnectTransport({ baseUrl: "http://localhost:8080" });
// Type cast to sidestep strict inference between our minimal proto types
const client = createPromiseClient(PriceService as any, transport) as any;

export default function Home() {
  const [input, setInput] = React.useState("");
  const [tickers, setTickers] = React.useState<string[]>([]);
  const [data, setData] = React.useState<Record<string, TickerState>>({});
  const streamsRef = React.useRef<Record<string, AbortController>>({});

  const addTicker = React.useCallback(() => {
    const t = input.trim().toUpperCase();
    if (!t) return;
    if (tickers.includes(t)) return;
    const next = [...tickers, t].sort();
    setTickers(next);
    setInput("");
  }, [input, tickers]);

  const removeTicker = React.useCallback((t: string) => {
    setTickers((prev) => prev.filter((x) => x !== t));
    const ctrl = streamsRef.current[t];
    if (ctrl) {
      console.log("[web] aborting stream for", t);
      ctrl.abort();
      delete streamsRef.current[t];
    }
    setData((prev) => ({ ...prev, [t]: { ...prev[t], status: "stopped" } }));
  }, []);

  React.useEffect(() => {
    // Start streams for new tickers
    for (const t of tickers) {
      if (!streamsRef.current[t]) {
        const ctrl = new AbortController();
        streamsRef.current[t] = ctrl;
        setData((prev) => ({ ...prev, [t]: { status: "connecting" } }));
        (async () => {
          try {
            console.log("[web] subscribeTicker start", t);
            for await (const update of client.subscribeTicker(
              { ticker: t },
              { signal: ctrl.signal }
            )) {
              const u = update as PriceUpdate;
              if (Number.isNaN(u.price)) {
                setData((prev) => ({
                  ...prev,
                  [t]: { ...prev[t], status: "connecting" },
                }));
                continue;
              }
              console.log("[web] update", t, u.price, u.isoTime);
              setData((prev) => ({
                ...prev,
                [t]: {
                  price: u.price,
                  isoTime: u.isoTime,
                  status: "streaming",
                },
              }));
            }
          } catch (e: any) {
            if (ctrl.signal.aborted) return;
            console.error("[web] stream error", t, e);
            setData((prev) => ({
              ...prev,
              [t]: { ...prev[t], status: "error", error: String(e) },
            }));
          } finally {
            console.log("[web] subscribeTicker end", t);
          }
        })();
      }
    }
    // Cleanup streams that no longer have a ticker
    for (const t of Object.keys(streamsRef.current)) {
      if (!tickers.includes(t)) {
        streamsRef.current[t].abort();
        delete streamsRef.current[t];
      }
    }
  }, [tickers]);

  return (
    <div style={{ padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h1>Project Pluto – Crypto Prices</h1>
      <p>
        Enter a ticker symbol (e.g., BTCUSD, ETHUSD, SOLUSD). Exchange is fixed
        to BINANCE.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Ticker (e.g., BTCUSD)"
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTicker();
          }}
          style={{ padding: 8, fontSize: 16 }}
        />
        <button onClick={addTicker} style={{ padding: "8px 12px" }}>
          Add
        </button>
      </div>

      <div>
        <h2>Tickers (sorted)</h2>
        {tickers.length === 0 && <p>No tickers yet. Add one above.</p>}
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {tickers.map((t) => {
            const s = data[t];
            return (
              <li
                key={t}
                style={{
                  border: "1px solid #ddd",
                  padding: 12,
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <strong>{t}</strong>
                  <button onClick={() => removeTicker(t)}>Remove</button>
                </div>
                <div style={{ marginTop: 6 }}>
                  <div>Status: {s?.status ?? "idle"}</div>
                  {s?.price !== undefined && (
                    <div>
                      Price: <strong>{s.price}</strong>
                    </div>
                  )}
                  {s?.isoTime && <div>As of: {s.isoTime}</div>}
                  {s?.error && (
                    <div style={{ color: "red" }}>Error: {s.error}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
