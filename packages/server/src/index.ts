import { createServer } from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  ConnectRouter,
  Interceptor,
  ConnectError,
  Code,
} from "@connectrpc/connect";

import { PriceService } from "@pluto/proto";
import { PriceUpdate, SubscribeRequest } from "@pluto/proto";

import { BrowserManager } from "./scraper.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

function routes(router: ConnectRouter) {
  router.service(PriceService, {
    async subscribeTicker(req: SubscribeRequest, ctx) {
      const ticker = (req.ticker || "").toUpperCase();
      console.log(`[server] subscribeTicker start: ${ticker}`);
      let manager: BrowserManager;
      try {
        manager = await BrowserManager.get();
      } catch (e: any) {
        console.error(`[server] failed to init BrowserManager for ${ticker}:`, e?.stack || e);
        throw new ConnectError("internal error initializing browser", Code.Internal);
      }
      console.log(`[server] browser ready for ${ticker}`);
      const ac = new AbortController();

      const stream = async function* () {
        // Wire price events to stream
        const queue: PriceUpdate[] = [];
        let pendingResolve: ((v: IteratorResult<PriceUpdate>) => void) | null = null;
        const push = (u: PriceUpdate) => {
          if (pendingResolve) {
            pendingResolve({ value: u, done: false });
            pendingResolve = null;
          } else {
            queue.push(u);
          }
        };

        let unsubscribe: () => Promise<void> | void = () => {};
        try {
          try {
            unsubscribe = await manager.subscribe(
              ticker,
              (e) => {
                console.log(`[server] price ${e.ticker}: ${e.price}`);
                push(new PriceUpdate(e));
              },
              () => {}
            );
          } catch (e: any) {
            const msg = `Failed to load ticker '${ticker}'. Try a BINANCE symbol like BTCUSDT.`;
            console.error(`[server] subscribeTicker error for ${ticker}:`, e);
            throw new ConnectError(msg, Code.InvalidArgument);
          }

          ctx.signal.addEventListener("abort", () => {
            ac.abort();
          });

          while (!ac.signal.aborted) {
            if (queue.length === 0) {
              const p = new Promise<IteratorResult<PriceUpdate>>((resolve) => (pendingResolve = resolve));
              // eslint-disable-next-line no-await-in-loop
              const r = await p;
              yield r.value as PriceUpdate;
            } else {
              const next = queue.shift()!;
              yield next;
            }
          }
        } catch (err: any) {
          console.error(`[server] internal stream error for ${ticker}:`, err?.stack || err);
          throw new ConnectError("internal error", Code.Internal);
        } finally {
          try {
            await unsubscribe();
          } catch {}
          console.log(`[server] subscribeTicker end: ${ticker}`);
        }
      };

      return stream();
    },
  });
}

const cors: Interceptor = (next) => async (req) => {
  const res = await next(req);
  const h = res.header;
  h.set("Access-Control-Allow-Origin", req.header.get("origin") ?? "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "Authorization",
      // Connect headers (case-insensitive, include common casings)
      "Connect-Protocol-Version",
      "Connect-Content-Encoding",
      "Connect-Accept-Encoding",
      "connect-protocol-version",
      "connect-content-encoding",
      "connect-accept-encoding",
    ].join(", ")
  );
  h.set(
    "Access-Control-Expose-Headers",
    [
      "Content-Type",
      "Connect-Content-Encoding",
      "Connect-Accept-Encoding",
    ].join(", ")
  );
  return res;
};

// Use the Connect Node adapter to handle requests
const handler = connectNodeAdapter({ routes, interceptors: [cors] });

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    // CORS preflight: echo requested headers so browsers allow custom Connect headers
    const origin = req.headers.origin ?? "*";
    const acrh = req.headers["access-control-request-headers"]; // may be a string
    console.log("[server] CORS preflight", {
      url: req.url,
      origin,
      acrh,
      method: req.headers["access-control-request-method"],
    });
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      typeof acrh === "string"
        ? acrh
        : "content-type, authorization, connect-protocol-version, connect-accept-encoding, connect-content-encoding"
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    res.end();
    return;
  }
  handler(req, res);
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
