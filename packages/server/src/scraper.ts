import { chromium, Browser, BrowserContext, Page } from "playwright";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

export type PriceEvent = { ticker: string; price: number; isoTime: string };

class PageScraper {
  private page?: Page;
  private emitter = new EventEmitter();
  private subs = 0;
  private closingTimer?: NodeJS.Timeout;
  private lastPrice?: number;

  constructor(private context: BrowserContext, private ticker: string) {}

  subscribe(onPrice: (e: PriceEvent) => void, onClose: () => void) {
    this.subs++;
    const handler = (e: PriceEvent) => onPrice(e);
    this.emitter.on("price", handler);
    return () => {
      this.emitter.off("price", handler);
      this.subs = Math.max(0, this.subs - 1);
      if (this.subs === 0) this.scheduleClose();
      onClose();
    };
  }

  async ensureStarted() {
    if (this.page) return;
    console.log(`[scraper] Starting page for ${this.ticker}`);
    const page = await this.context.newPage();
    console.log(`[scraper] newPage created for ${this.ticker}`);
    this.page = page;
    page.setDefaultNavigationTimeout(45000);

    // Warmup root to set cookies, then open chart with explicit exchange prefix
    const warmup = "https://www.tradingview.com/";
    const url = `https://www.tradingview.com/chart/?symbol=BINANCE:${encodeURIComponent(this.ticker)}`;

    try {
      await page.goto(warmup, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      // Attempt to accept cookies if a banner appears
      await this.tryAcceptCookies(page).catch(() => {});

      for (let i = 1; i <= 3; i++) {
        try {
          console.log(`[scraper] navigating to ${url} (attempt ${i}/3)`);
          await page.goto(url, { waitUntil: "load", timeout: 45000 });
          await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
          break;
        } catch (e) {
          if (i === 3) throw e;
          await new Promise((r) => setTimeout(r, 1000 * i));
        }
      }
    } catch (e) {
      console.error(`[scraper] navigation failed for ${this.ticker}`, e);
      throw e;
    }

    // Expose a function to receive price updates from the page
    await page.exposeFunction("__notifyPrice", (price: number) => {
      if (typeof price === "number" && !Number.isNaN(price)) {
        if (this.lastPrice !== price) {
          this.lastPrice = price;
          const evt: PriceEvent = {
            ticker: this.ticker,
            price,
            isoTime: new Date().toISOString(),
          };
          this.emitter.emit("price", evt);
        }
      }
    });

    // Wait until a likely price element is present, then wire observers
    await this.waitForPricePresence(page);
    await this.installObserver(page);
    console.log(`[scraper] observers installed for ${this.ticker}`);
  }

  private async tryAcceptCookies(page: Page) {
    const candidates = [
      'button:has-text("Accept")',
      'button:has-text("I agree")',
      'button:has-text("I accept")',
      'button:has-text("Got it")',
      '[data-name="cookies-accept-all"]',
    ];
    for (const sel of candidates) {
      const loc = page.locator(sel);
      if (await loc.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`[scraper] clicking cookie consent via ${sel}`);
        await loc.first().click({ timeout: 2000 }).catch(() => {});
        break;
      }
    }
  }

  private async waitForPricePresence(page: Page) {
    await page.waitForFunction(() => {
      const looksLikePriceText = (el: Element | null) => {
        if (!el || !(el as any).textContent) return false;
        const t = (el as any).textContent.trim();
        if (t.length < 1) return false;
        return /[0-9]/.test(t);
      };
      const selectors = [
        'div[data-name="legend-series-value"]',
        'div[data-name="legend-price"]',
        'span[data-name="last-price-value"]',
        '.tv-symbol-price-quote__value',
        '[data-qa="price"]',
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of Array.from(els)) {
          if (looksLikePriceText(el)) return true;
        }
      }
      return false;
    }, { timeout: 20000 });
  }

  private async installObserver(page: Page) {
    await page.addInitScript({
      content: `
        (function(){
          function parseNum(s){
            if (!s) return NaN;
            const m = String(s).replace(/[^0-9.,]/g, '').replace(/,/g,'');
            return parseFloat(m);
          }
          function looksLikePriceText(el){
            if (!el || !el.textContent) return false;
            const t = el.textContent.trim();
            if (t.length < 1) return false;
            return /[0-9]/.test(t);
          }
          function findByCandidates(){
            const selectors = [
              'div[data-name="legend-series-value"]',
              'div[data-name="legend-price"]',
              'span[data-name="last-price-value"]',
              '.tv-symbol-price-quote__value',
              '[data-qa="price"]',
              'span', 'div'
            ];
            for (const sel of selectors){
              const nodes = document.querySelectorAll(sel);
              for (const n of nodes){
                if (looksLikePriceText(n)) return n;
              }
            }
            return null;
          }
          let priceEl = findByCandidates();
          function report(){
            if (!priceEl) return;
            const v = parseNum(priceEl.textContent || '');
            if (!Number.isNaN(v)) {
              // @ts-ignore
              window.__notifyPrice(v);
            }
          }
          const obs = new MutationObserver(() => {
            if (!priceEl) priceEl = findByCandidates();
            report();
          });
          obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
          setInterval(report, 1000);
          report();
        })();
      `,
    });

    // Attach the observer immediately for the current page content
    await page.evaluate(() => {
      function parseNum(s){
        if (!s) return NaN;
        const m = String(s).replace(/[^0-9.,]/g, '').replace(/,/g,'');
        return parseFloat(m);
      }
      function looksLikePriceText(el){
        if (!el || !(el as any).textContent) return false;
        const t = (el as any).textContent.trim();
        if (t.length < 1) return false;
        return /[0-9]/.test(t);
      }
      function findByCandidates(){
        const selectors = [
          'div[data-name="legend-series-value"]',
          'div[data-name="legend-price"]',
          'span[data-name="last-price-value"]',
          '.tv-symbol-price-quote__value',
          '[data-qa="price"]',
          'span', 'div'
        ];
        for (const sel of selectors){
          const nodes = document.querySelectorAll(sel);
          for (const n of Array.from(nodes)){
            if (looksLikePriceText(n as Element)) return n as Element;
          }
        }
        return null as Element | null;
      }
      let priceEl = findByCandidates();
      function report(){
        if (!priceEl) return;
        const v = parseNum((priceEl as any).textContent || '');
        if (!Number.isNaN(v)) {
          // @ts-ignore
          (window as any).__notifyPrice(v);
        }
      }
      const obs = new MutationObserver(() => {
        if (!priceEl) priceEl = findByCandidates();
        report();
      });
      obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      setInterval(report, 1000);
      report();
    });
  }

  private scheduleClose() {
    if (this.closingTimer) return;
    this.closingTimer = setTimeout(() => this.stop().catch(() => {}), 30000);
  }

  private clearCloseTimer() {
    if (this.closingTimer) {
      clearTimeout(this.closingTimer);
      this.closingTimer = undefined;
    }
  }

  async stop() {
    this.clearCloseTimer();
    const p = this.page;
    if (p) {
      console.log(`[scraper] Closing page for ${this.ticker}`);
      this.page = undefined;
      try { await p.close({ runBeforeUnload: true }); } catch {}
    }
  }
}

export class BrowserManager {
  private static instance?: BrowserManager;
  static async get(): Promise<BrowserManager> {
    if (!this.instance) this.instance = new BrowserManager();
    await this.instance.ensure();
    return this.instance;
  }

  private browser?: Browser;
  private context?: BrowserContext;
  private scrapers = new Map<string, PageScraper>();
  private feeds = new Map<string, BinanceFeed>();

  private async ensure() {
    if (!this.browser) {
      console.log("[scraper] Launching Chromium (headed mode)");
      this.browser = await chromium.launch({ headless: false });
      console.log("[scraper] chromium.launch ok");
      const ua = (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/119.0.0.0 Safari/537.36'
      );
      this.context = await this.browser.newContext({
        userAgent: ua,
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        ignoreHTTPSErrors: true,
      });
      console.log("[scraper] browser context created");
    }
  }

  static normalizeTicker(input: string): string {
    let t = (input || '').toUpperCase().replace(/[^A-Z]/g, '');
    t = t.replace(/(USDT)+$/i, 'USDT');
    if (t.endsWith('USDT')) return t;
    if (t.endsWith('USD')) return t.replace(/USD$/, 'USDT');
    if (/^[A-Z]{2,6}$/.test(t)) return t + 'USDT';
    return t;
  }

  async subscribe(ticker: string, onPrice: (e: PriceEvent) => void, onClose: () => void) {
    console.log(`[scraper] subscribe() enter ticker=${ticker}`);
    const t = BrowserManager.normalizeTicker(ticker);
    if (t !== ticker.toUpperCase()) {
      console.log(`[scraper] normalized ticker ${ticker} -> ${t}`);
    } else {
      console.log(`[scraper] using ticker ${t}`);
    }
    const source = (process.env.PRICE_SOURCE || 'binance').toLowerCase();
    if (source === 'binance') {
      // Use Binance WebSocket feed for reliability
      let feed = this.feeds.get(t);
      if (!feed) {
        feed = new BinanceFeed(t);
        this.feeds.set(t, feed);
        await feed.ensureStarted();
      } else {
        await feed.ensureStarted();
      }
      const unsubscribe = feed.subscribe(onPrice, onClose);
      return async () => unsubscribe();
    } else {
      // Use Playwright TradingView scraper (headed)
      await this.ensure();
      console.log(`[scraper] ensure() done for ${t}`);
      let s = this.scrapers.get(t);
      if (!s) {
        console.log(`[scraper] creating PageScraper for ${t}`);
        s = new PageScraper(this.context!, t);
        this.scrapers.set(t, s);
        try {
          await s.ensureStarted();
          console.log(`[scraper] ensureStarted() returned for ${t}`);
        } catch (e) {
          console.error(`[scraper] ensureStarted() failed for ${t}`, e);
          throw e;
        }
      } else {
        try {
          await s.ensureStarted();
          console.log(`[scraper] ensureStarted() returned for existing ${t}`);
        } catch (e) {
          console.error(`[scraper] ensureStarted() failed for existing ${t}`, e);
          throw e;
        }
      }
      const unsubscribe = s.subscribe(onPrice, onClose);
      return async () => {
        unsubscribe();
      };
    }
  }
}

class BinanceFeed {
  private emitter = new EventEmitter();
  private subs = 0;
  private closingTimer?: NodeJS.Timeout;
  private ws?: WebSocket;
  private lastPrice?: number;

  constructor(private symbol: string) {}

  subscribe(onPrice: (e: PriceEvent) => void, onClose: () => void) {
    this.subs++;
    const handler = (e: PriceEvent) => onPrice(e);
    this.emitter.on('price', handler);
    return () => {
      this.emitter.off('price', handler);
      this.subs = Math.max(0, this.subs - 1);
      if (this.subs === 0) this.scheduleClose();
      onClose();
    };
  }

  private scheduleClose() {
    if (this.closingTimer) return;
    this.closingTimer = setTimeout(() => this.stop().catch(() => {}), 30000);
  }

  private clearCloseTimer() {
    if (this.closingTimer) {
      clearTimeout(this.closingTimer);
      this.closingTimer = undefined;
    }
  }

  async ensureStarted() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    const stream = `${this.symbol.toLowerCase()}@trade`;
    const url = `wss://stream.binance.com:9443/ws/${stream}`;
    console.log(`[binance] connecting ${url}`);
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, { handshakeTimeout: 15000 });
      this.ws = ws;
      let opened = false;
      ws.on('open', () => { opened = true; console.log(`[binance] connected ${url}`); resolve(); });
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(String(data));
          const pStr = msg.p ?? msg.price ?? msg.c;
          const price = typeof pStr === 'string' ? parseFloat(pStr) : Number(pStr);
          if (typeof price === 'number' && !Number.isNaN(price)) {
            if (this.lastPrice !== price) {
              this.lastPrice = price;
              const evt: PriceEvent = { ticker: this.symbol, price, isoTime: new Date().toISOString() };
              this.emitter.emit('price', evt);
            }
          }
        } catch {}
      });
      ws.on('error', (err) => { console.error(`[binance] ws error for ${this.symbol}`, err); if (!opened) reject(err); });
      ws.on('close', (code, reason) => { console.warn(`[binance] ws closed ${this.symbol} ${code} ${reason}`); });
    });
  }

  async stop() {
    this.clearCloseTimer();
    const w = this.ws;
    if (w) {
      try { w.close(); } catch {}
      this.ws = undefined;
    }
  }
}
