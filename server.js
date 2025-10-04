// server.js
// Simple, robust proxy to Yahoo Finance for ^NSEI (Nifty 50)
// Usage: npm install express undici
// Then: node server.js

const express = require("express");
const path = require("path");
const { fetch } = require("undici"); // fast built-in fetch for Node

const app = express();
const PORT = 3000;

// Serve static files from ./public (your index.html should be inside public/)
app.use(express.static(path.join(__dirname, "public")));

// small in-memory cache to avoid pounding Yahoo
let cache = {
  value: null,
  time: 0
};
const CACHE_TTL_MS = 5000; // 5 seconds

app.get("/nifty", async (req, res) => {
  try {
    const now = Date.now();
    if (cache.value !== null && (now - cache.time) < CACHE_TTL_MS) {
      // return cached value
      console.log("[/nifty] returning cached value:", cache.value);
      return res.json({ nifty: cache.value, cached: true });
    }

    const url = "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1m&range=1d";
    console.log("[/nifty] fetching from Yahoo:", url);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NiftyProxy/1.0)",
        "Accept": "application/json"
      },
      // undici fetch is reasonably quick; we rely on default behavior
    });

    if (!response || !response.ok) {
      const txt = await (response && response.text ? response.text() : "no body");
      console.error("[/nifty] Yahoo returned non-OK:", response && response.status, txt);
      return res.status(502).json({ error: "Yahoo fetch failed", status: response && response.status, body: txt });
    }

    const data = await response.json();

    // Defensive parsing
    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result) {
      console.error("[/nifty] No result in Yahoo response. data.chart:", JSON.stringify(data.chart).slice(0, 500));
      return res.status(502).json({ error: "No result in Yahoo response", chart: data.chart || null });
    }

    const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
    const closes = quote && quote.close;
    if (!Array.isArray(closes) || closes.length === 0) {
      console.error("[/nifty] closes array missing or empty. result:", JSON.stringify(result).slice(0, 500));
      return res.status(502).json({ error: "No close values", result });
    }

    // find last non-null close reading
    let nifty = null;
    for (let i = closes.length - 1; i >= 0; i--) {
      const v = closes[i];
      if (v !== null && v !== undefined && !Number.isNaN(v)) { nifty = v; break; }
    }

    if (nifty === null) {
      console.error("[/nifty] Could not determine a valid close value. closes:", closes.slice(-6));
      return res.status(502).json({ error: "Could not find latest close value", closes: closes.slice(-10) });
    }

    // store in cache
    cache.value = nifty;
    cache.time = Date.now();

    console.log("[/nifty] success. nifty =", nifty);
    res.json({ nifty, cached: false });
  } catch (err) {
    console.error("[/nifty] server error:", err && err.stack ? err.stack : err);
    res.status(500).json({ error: "Server error", detail: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}  (serving ./public/index.html)`);
});
