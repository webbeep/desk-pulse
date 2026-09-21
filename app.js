(function (root) {
  "use strict";

  const BOOK_MS = 10000;
  const MARK_MS = 15000;
  const SPOT = {
    ETH: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
    BTC: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    LINK: "https://api.coinbase.com/v2/prices/LINK-USD/spot",
  };
  // jsDelivr first — GH Pages status=errored was serving stale PAPER book.
  const SOURCES = [
    "https://cdn.jsdelivr.net/gh/webbeep/desk-pulse@main/book.json",
    "./book.json",
  ];
  async function loadVersionPinned() {
    try {
      const v = await loadOne("./version.json");
      if (v && v.sha) {
        return "https://cdn.jsdelivr.net/gh/webbeep/desk-pulse@" + v.sha + "/book.json";
      }
    } catch (e) {}
    return null;
  }

  const CHAIN_LABELS = {
    L1: "Ethereum L1",
    Arb: "Arbitrum",
    Base: "Base",
    RH: "Robinhood Chain",
    l1_eth: "L1 ETH",
    arb_eth: "Arb ETH",
    arb_usdc: "Arb USDC",
    base_eth: "Base ETH",
    base_usdc: "Base USDC",
    rh_eth: "RH ETH",
  };

  const $ = (id) => document.getElementById(id);

  let bookRaw = null;
  let bookSrc = "";
  let bookAt = 0;
  let liveMark = null;
  let markAt = 0;
  let markAsset = "ETH";
  let marks = { ETH: null, BTC: null, LINK: null };
  let bookMarks = { ETH: null, BTC: null, LINK: null };

  function money(n, digits) {
    if (digits == null) digits = 2;
    if (n == null || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    const sign = v < 0 ? "-" : "";
    return sign + "$" + Math.abs(v).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function px(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function qty(n, key) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    const stable = /usdc|usd|usdt/i.test(String(key || ""));
    const digits = stable ? 2 : Math.abs(v) >= 1 ? 4 : 6;
    return v.toLocaleString("en-US", {
      minimumFractionDigits: stable ? 2 : 0,
      maximumFractionDigits: digits,
    });
  }

  function truncAddr(a) {
    if (!a || typeof a !== "string") return "—";
    if (!a.startsWith("0x") || a.length < 10) return a;
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function truncTx(a) {
    if (!a || typeof a !== "string") return "—";
    if (!a.startsWith("0x") || a.length < 12) return a;
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] != null) return obj[k];
    }
    return null;
  }

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }

  function compactTime(raw) {
    if (!raw) return "—";
    const s = String(raw).trim();
    const m = s.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?\s*(ET)?/i);
    if (m) return m[2] + (m[3] ? " ET" : "") + " " + m[1].slice(5);
    if (s.length > 22) return s.slice(0, 20);
    return s;
  }

  function normalizePos(p) {
    if (!p || typeof p !== "object") return null;
    return {
      id: pick(p, ["id"]),
      side: pick(p, ["side"]),
      market: pick(p, ["market"]),
      leverage: num(pick(p, ["leverage"])),
      collateralUsd: num(pick(p, ["collateralUsd", "collateral_usd"])),
      collateralToken: pick(p, ["collateralToken", "collateral_token"]),
      sizeUsd: num(pick(p, ["sizeUsd", "size_usd"])),
      entry: num(pick(p, ["entry"])),
      mark: num(pick(p, ["mark"])),
      sl: num(pick(p, ["sl"])),
      tp: num(pick(p, ["tp"])),
      venue: pick(p, ["venue"]),
      status: pick(p, ["status"]),
      upnlUsd: num(pick(p, ["upnlUsd", "upnl_usd", "uPnL", "upnl"])),
    };
  }

  function positionsFrom(raw) {
    if (Array.isArray(raw.positions)) {
      return raw.positions.map(normalizePos).filter(Boolean);
    }
    const legacy = normalizePos(raw.position);
    return legacy ? [legacy] : [];
  }

  function isOpen(p) {
    if (!p) return false;
    const st = String(p.status || "").toUpperCase();
    if (st === "FLAT" || st === "CLOSED") return false;
    if (!p.side) return false;
    if (p.sizeUsd != null && Number(p.sizeUsd) === 0) return false;
    return true;
  }

  function upnlOf(p, mark) {
    const entry = p.entry;
    const size = p.sizeUsd;
    const m = mark != null ? mark : p.mark;
    if (entry == null || size == null || m == null || entry === 0) return p.upnlUsd;
    const side = String(p.side || "LONG").toUpperCase();
    if (side === "SHORT") return ((entry - m) / entry) * size;
    return ((m - entry) / entry) * size;
  }

  function parseUpdatedEtMs(raw) {
    const et = pick(raw || {}, ["updatedEt", "updated_et", "updatedAt", "updated_at"]);
    const m = String(et || "").match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return 0;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  }

  function rawIsFlat(raw) {
    if (!raw) return true;
    const st = String(pick(raw, ["status"]) || "").toUpperCase();
    const open = positionsFrom(raw).filter(isOpen);
    return st === "FLAT" || open.length === 0;
  }


  let histRange = "session";
  let lastFullHist = [];

  function parseEtMs(s) {
    if (!s || s === "session_start" || s === "now") return null;
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2]-1, +m[3], +m[4]+4, +m[5], +m[6]);
  }

  function filterHistRange(hist, range) {
    const arr = Array.isArray(hist) ? hist.slice() : [];
    if (!arr.length || range === "all" || range === "session") return arr;
    const now = Date.now();
    const win = range === "1h" ? 3600e3 : range === "6h" ? 6*3600e3 : null;
    if (!win) return arr;
    const cut = now - win;
    const kept = arr.filter(function (h) {
      const ms = parseEtMs(pick(h, ["t", "updated_et"]));
      return ms == null || ms >= cut;
    });
    return kept.length >= 2 ? kept : arr;
  }

  function wireHistRange() {
    const row = $("hist-range");
    if (!row || row.dataset.wired) return;
    row.dataset.wired = "1";
    row.addEventListener("click", function (ev) {
      const btn = ev.target && ev.target.closest ? ev.target.closest("[data-range]") : null;
      if (!btn) return;
      histRange = btn.getAttribute("data-range") || "session";
      row.querySelectorAll(".range-btn").forEach(function (b) { b.classList.toggle("active", b === btn); });
      renderHist(filterHistRange(lastFullHist, histRange));
    });
  }

  function normalize(raw) {
    const positions = positionsFrom(raw);
    const open = positions.filter(isOpen);
    const rawSt = String(pick(raw, ["status"]) || "").toUpperCase();
    let status;
    if (rawSt === "FLAT" || open.length === 0) status = "FLAT";
    else status = rawSt || "LIVE";

    const histRaw = raw.pnl_history || raw.history || [];
    const hist = (Array.isArray(histRaw) ? histRaw : []).filter(function (h) {
      if (!h || typeof h !== "object") return false;
      const e = num(pick(h, ["equity_usd", "equityUsd"]));
      const l = num(pick(h, ["liquid_usd", "liquidUsd"]));
      return e != null && l != null;
    });

    const funding = num(pick(raw, ["fundingUsd", "funding_usd"]));
    // V2 cutover: never invent legacy $107 — missing funding means 0
    const fundingUsd = funding != null ? funding : 0;

    return {
      updatedEt: pick(raw, ["updatedEt", "updated_et", "updatedAt", "updated_at"]),
      status: String(status).toUpperCase(),
      liquidUsd: num(pick(raw, ["liquidUsd", "liquid_usd"])),
      bookUpnl: num(pick(raw, ["openUpnlUsd", "upnl_usd", "open_upnl_usd"])),
      bookEquity: num(pick(raw, ["equityUsd", "equity_usd"])),
      fundingUsd: fundingUsd,
      fundingNote: pick(raw, ["fundingNote", "funding_note"]),
      totalPnlUsd: num(pick(raw, ["totalPnlUsd", "total_pnl_usd"])),
      totalPnlPct: num(pick(raw, ["totalPnlPct", "total_pnl_pct"])),
      residuals: (raw.residuals && typeof raw.residuals === "object") ? raw.residuals : {},
      holdings: (raw.holdings && typeof raw.holdings === "object") ? raw.holdings : null,
      wallet: pick(raw, ["wallet", "account"]),
      walletUrls: pick(raw, ["walletUrls", "wallet_urls"]),
      notes: pick(raw, ["notes"]),
      positions: positions,
      pnlHistory: hist,
      trades: Array.isArray(raw.trades) ? raw.trades : [],
      mode: pick(raw, ["mode", "display_mode", "displayMode"]),
      paper: (raw.paper && typeof raw.paper === "object") ? raw.paper : null,
      markSrc: pick(raw, ["mark_src", "markSrc"]),
      marks: (function () {
        const src = raw.marks || raw.spot || {};
        const eth = num(pick(src, ["ETH", "eth", "ETH-USD", "eth_usd"])) ?? num(pick(raw, ["mark_eth", "markEth"]));
        const btc = num(pick(src, ["BTC", "btc", "BTC-USD", "btc_usd"])) ?? num(pick(raw, ["mark_btc", "markBtc"]));
        const link = num(pick(src, ["LINK", "link", "LINK-USD", "link_usd"])) ?? num(pick(raw, ["mark_link", "markLink"]));
        return { ETH: eth, BTC: btc, LINK: link };
      })(),
    };
  }

  function assetOf(p) {
    const m = String((p && p.market) || "").toUpperCase();
    if (m.indexOf("LINK") >= 0) return "LINK";
    if (m.indexOf("BTC") >= 0 || m.indexOf("WBTC") >= 0) return "BTC";
    if (m.indexOf("ETH") >= 0) return "ETH";
    if (m) {
      const tok = (m.split(/[\/:\-\s]/)[0] || "").replace(/[^A-Z0-9]/g, "");
      if (tok && tok !== "GMX" && tok !== "USD" && tok !== "USDC") return tok;
      return null;
    }
    return markAsset || "ETH";
  }

  function markFor(p) {
    const a = assetOf(p);
    if (marks[a] != null) return marks[a];
    if (bookMarks[a] != null) return bookMarks[a];
    if (p && p.mark != null) return p.mark;
    return null;
  }

  function liveNumbers(book) {
    const st0 = String(book.status || "").toUpperCase();
    if (st0 === "FLAT" && !(book.positions && book.positions.length)) {
      const liquid = book.liquidUsd != null ? book.liquidUsd : 0;
      const equity = book.bookEquity != null ? book.bookEquity : liquid;
      return { mark: (book.marks && book.marks.ETH) || null, asset: "ETH", upnl: book.bookUpnl != null ? book.bookUpnl : 0, equity: equity, cards: [], open: [] };
    }
    const open = book.positions.filter(isOpen);
    let upnl = 0;
    let coll = 0;
    let usedWriter = false;
    const cards = book.positions.map(function (p) {
      const a = assetOf(p);
      const m = markFor(p);
      let u = 0;
      if (isOpen(p)) {
        if (marks[a] != null) {
          u = upnlOf(p, marks[a]);
        } else if (p.upnlUsd != null) {
          u = p.upnlUsd;
          usedWriter = true;
        } else if (book.bookUpnl != null) {
          u = book.bookUpnl;
          usedWriter = true;
        } else {
          u = upnlOf(p, m);
        }
        upnl += u || 0;
        coll += p.collateralUsd || 0;
      }
      return { p: p, mark: m, upnl: u };
    });
    const primary = open.length ? assetOf(open[0]) : markAsset;
    const mark = marks[primary] != null
      ? marks[primary]
      : (bookMarks[primary] != null
        ? bookMarks[primary]
        : (open[0] && open[0].mark != null ? open[0].mark : null));
    const liquid = book.liquidUsd != null ? book.liquidUsd : 0;
    let totalUpnl;
    if (!open.length) {
      totalUpnl = book.bookUpnl != null ? book.bookUpnl : 0;
    } else if (usedWriter && open.every(function (p) { return marks[assetOf(p)] == null; }) && book.bookUpnl != null) {
      totalUpnl = book.bookUpnl;
      upnl = book.bookUpnl;
    } else {
      totalUpnl = upnl;
    }
    // Paper sleeve: liquid_usd is already full paper equity (not idle cash). Do not add collateral.
    const paperMode = String(bookRaw && (bookRaw.mode || bookRaw.display_mode) || "").toUpperCase() === "PAPER"
      || !!(bookRaw && bookRaw.paper && bookRaw.paper.active);
    let equity;
    if (paperMode) {
      if (book.bookEquity != null) equity = book.bookEquity;
      else equity = liquid + (totalUpnl || 0);
    } else {
      equity = open.length ? liquid + coll + (totalUpnl || 0) : (book.bookEquity != null ? book.bookEquity : liquid);
    }
    return { mark: mark, asset: primary, upnl: totalUpnl, equity: equity, cards: cards, open: open, paperMode: paperMode };
  }

  function setTone(el, n) {
    if (!el) return;
    el.classList.remove("up", "down");
    if (n == null || Number.isNaN(Number(n))) return;
    if (Number(n) > 0) el.classList.add("up");
    if (Number(n) < 0) el.classList.add("down");
  }

  function setStatus(status) {
    const el = $("status");
    if (!el) return;
    const s = String(status || "FLAT").toUpperCase();
    el.textContent = s;
    el.className = "status";
    if (s === "LIVE" || s === "MIXED") el.classList.add("live");
    else if (s === "RISK") el.classList.add("risk");
    else el.classList.add("flat");
  }

  function ageText(ts) {
    if (!ts) return "—";
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + "s";
    return Math.floor(s / 60) + "m" + (s % 60) + "s";
  }

  function paintAge() {
    const el = $("mark-age");
    if (el) {
      el.textContent = "age " + ageText(markAt);
      el.className = "age";
      if (markAt) {
        const s = (Date.now() - markAt) / 1000;
        if (s > 45) el.classList.add("dead");
        else if (s > 20) el.classList.add("stale");
      }
    }
    const ba = $("book-age");
    if (ba) ba.textContent = "book " + ageText(bookAt);
  }

  function paintStale() {
    const el = $("err");
    if (!el || !bookRaw) return;
    // Prefer time since we successfully fetched book (CDN lag ≠ writer lag).
    const fetchLagMin = bookAt ? (Date.now() - bookAt) / 60000 : 99;
    const et = normalize(bookRaw).updatedEt || "";
    const m = String(et).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    let stampLagMin = 0;
    if (m) {
      // ET ≈ UTC-4 in Sep (EDT)
      const approx = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 4, +m[5], +(m[6] || 0));
      stampLagMin = (Date.now() - approx) / 60000;
    }
    // Warn only if BOTH fetch is old and stamp is old (avoid false stale from one CDN hop)
    if (fetchLagMin > 3 && stampLagMin > 12) {
      el.hidden = false;
      el.textContent = "Book stale · " + et + " · stamp lag ~" + Math.round(stampLagMin) + "m";
      el.className = "err stale";
    } else if (el.className === "err stale") {
      el.hidden = true;
      el.textContent = "";
      el.className = "err";
    }
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function kv(grid, k, v, vClass) {
    const cell = el("div");
    cell.append(el("span", "k", k), el("span", vClass || "v", v));
    grid.append(cell);
  }

  function renderTherm(host, pos, mark) {
    if (pos.sl == null || pos.tp == null || mark == null) return;
    const sl = Number(pos.sl);
    const tp = Number(pos.tp);
    const m = Number(mark);
    const lo = Math.min(sl, tp);
    const hi = Math.max(sl, tp);
    const span = hi - lo || 1;
    const pct = Math.min(1, Math.max(0, (m - lo) / span));

    const therm = el("div", "therm");
    const fill = el("div", "therm-fill");
    fill.style.width = (pct * 100).toFixed(2) + "%";
    const tSl = el("span", "tick sl");
    const tTp = el("span", "tick tp");
    const tMk = el("span", "tick mk");
    tSl.style.left = (((sl - lo) / span) * 100).toFixed(2) + "%";
    tTp.style.left = (((tp - lo) / span) * 100).toFixed(2) + "%";
    tMk.style.left = (pct * 100).toFixed(2) + "%";
    therm.append(fill, tSl, tMk, tTp);

    const toSl = ((m - sl) / m) * 100;
    const toTp = ((tp - m) / m) * 100;
    const dist = el("div", "dist");
    dist.append(
      el("span", toSl < 0 ? "down" : "", "SL " + (toSl >= 0 ? "+" : "") + toSl.toFixed(2) + "%"),
      el("span", toTp < 0 ? "down" : "up", "TP " + (toTp >= 0 ? "+" : "") + toTp.toFixed(2) + "%")
    );
    host.append(therm, dist);
  }

  function renderPositions(cards) {
    const list = $("pos-list");
    list.replaceChildren();
    const openCards = (cards || []).filter(function (c) { return isOpen(c.p); });
    const pc = $("pos-count");
    if (pc) pc.textContent = String(openCards.length);
    const pe = $("pos-empty");
    if (pe) pe.hidden = openCards.length > 0;
    for (const c of openCards) {
      const p = c.p;
      const card = el("article", "card");
      const head = el("div", "card-head");
      const side = String(p.side || "").toUpperCase();
      head.append(
        el("span", "mkt", [p.venue, p.market].filter(Boolean).join(" ") || "Position"),
        el("span", "pill " + (side === "SHORT" ? "short" : "long"), side || "—")
      );
      const grid = el("div", "grid");
      kv(grid, "Lev", p.leverage != null ? Number(p.leverage).toFixed(2) + "×" : "—");
      kv(grid, "Size", money(p.sizeUsd));
      kv(grid, "Entry", px(p.entry));
      kv(grid, "Mark", px(c.mark));
      kv(grid, "uPnL", money(c.upnl), "v" + (c.upnl > 0 ? " up" : c.upnl < 0 ? " down" : ""));
      card.append(head, grid);
      renderTherm(card, p, c.mark);
      list.append(card);
    }
  }

  function series(hist, key) {
    return hist.map(function (h) { return num(h[key]); }).filter(function (v) { return v != null; });
  }

  function pathFrom(vals, w, h, pad) {
    const pts = vals.map(function (v, i) { return { i: i, v: v }; }).filter(function (p) { return p.v != null; });
    if (pts.length < 2) return "";
    let lo = pts[0].v, hi = pts[0].v;
    for (const p of pts) {
      if (p.v < lo) lo = p.v;
      if (p.v > hi) hi = p.v;
    }
    const span = hi - lo || 1;
    const n = vals.length - 1 || 1;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;
    return pts.map(function (p, idx) {
      const x = pad + (p.i / n) * innerW;
      const y = pad + (1 - (p.v - lo) / span) * innerH;
      return (idx ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
  }

  function renderSpark(hist) {
    const svg = $("spark");
    if (!svg) return;
    svg.replaceChildren();
    const w = 320, h = 64, pad = 4;
    const pe = pathFrom(series(hist, "equity_usd"), w, h, pad);
    const pu = pathFrom(series(hist, "upnl_usd"), w, h, pad);
    function line(d, color) {
      if (!d) return;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", color);
      p.setAttribute("stroke-width", "1.5");
      svg.appendChild(p);
    }
    line(pe, "#ffffff");
    line(pu, "#00c805");
    const wrap = $("spark-wrap");
    if (wrap) wrap.hidden = !pe && !pu;
  }

  function renderHist(hist) {
    const body = $("hist-body");
    body.replaceChildren();
    $("hist-empty").hidden = hist.length > 0;
    for (const h of hist.slice().reverse()) {
      const u = num(pick(h, ["upnl_usd", "upnlUsd"]));
      const e = num(pick(h, ["equity_usd", "equityUsd"]));
      const tr = el("tr");
      tr.append(
        el("td", "", compactTime(pick(h, ["t", "updated_et"]))),
        el("td", u > 0 ? "up" : u < 0 ? "down" : "", money(u)),
        el("td", "", money(e)),
        el("td", "", String(pick(h, ["n_pos", "n"]) != null ? pick(h, ["n_pos", "n"]) : "—"))
      );
      body.append(tr);
    }
    renderSpark(hist);
  }

  function renderTrades(trades) {
    const body = $("trades-body");
    body.replaceChildren();
    $("trades-empty").hidden = trades.length > 0;
    for (const t of trades) {
      const pnl = num(pick(t, ["pnl_usd", "pnlUsd"]));
      const size = num(pick(t, ["size_usd", "sizeUsd"]));
      const tr = el("tr");
      tr.append(
        el("td", "", compactTime(pick(t, ["t"]))),
        el("td", "", String(pick(t, ["kind", "k"]) || "—")),
        el("td", "", String(pick(t, ["market"]) || "—")),
        el("td", "", String(pick(t, ["side"]) || "—")),
        el("td", "", size != null ? money(size) : "—"),
        el("td", pnl > 0 ? "up" : pnl < 0 ? "down" : "", money(pnl)),
        el("td", "", truncTx(pick(t, ["tx"])))
      );
      body.append(tr);
    }
  }

  function holdingsFrom(book) {
    if (book.holdings) {
      const order = ["L1", "Arb", "Base", "RH"];
      const cards = [];
      for (const key of order) {
        if (book.holdings[key]) cards.push({ key: key, assets: book.holdings[key] });
      }
      for (const key of Object.keys(book.holdings)) {
        if (order.indexOf(key) < 0) cards.push({ key: key, assets: book.holdings[key] });
      }
      return cards;
    }
    const r = book.residuals || {};
    return [
      { key: "L1", assets: { eth: r.l1_eth } },
      { key: "Arb", assets: { eth: r.arb_eth, usdc: r.arb_usdc } },
      { key: "Base", assets: { eth: r.base_eth, usdc: r.base_usdc } },
      { key: "RH", assets: { eth: r.rh_eth } },
    ];
  }

  function renderHoldings(book) {
    const grid = $("holdings-grid");
    if (!grid) return;
    grid.replaceChildren();
    for (const card of holdingsFrom(book)) {
      const node = el("div", "hold-card");
      node.append(el("p", "chain", CHAIN_LABELS[card.key] || card.key));
      const assets = card.assets || {};
      const keys = Object.keys(assets);
      if (!keys.length) {
        const row = el("div", "row");
        row.append(el("span", "k", "—"), el("span", "v", "0"));
        node.append(row);
      } else {
        for (const k of keys) {
          const row = el("div", "row");
          row.append(el("span", "k", String(k).toUpperCase()), el("span", "v", qty(assets[k], k)));
          node.append(row);
        }
      }
      grid.append(node);
    }
  }

  function walletUrlsFrom(book) {
    const urls = book.walletUrls;
    if (urls && typeof urls === "object") return urls;
    const w = book.wallet;
    if (!w) return null;
    return {
      ethereum: "https://etherscan.io/address/" + w,
      arbitrum: "https://arbiscan.io/address/" + w,
      base: "https://basescan.org/address/" + w,
      robinhood: "https://explorer.mainnet.chain.robinhood.com/address/" + w,
    };
  }

  function renderWalletLinks(book) {
    const host = $("wallet-links");
    if (!host) return;
    host.replaceChildren();
    const urls = walletUrlsFrom(book);
    if (!urls) return;
    const items = [
      { key: "ethereum", label: "Ethereum" },
      { key: "arbitrum", label: "Arbitrum" },
      { key: "base", label: "Base" },
      { key: "robinhood", label: "Robinhood" },
    ];
    for (const item of items) {
      const href = urls[item.key];
      if (!href) continue;
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = item.label;
      host.append(a);
    }
  }

  function render() {
    if (!bookRaw) return;
    const book = normalize(bookRaw);
    const err = $("err");
    if (err && err.className !== "err stale") {
      err.hidden = true;
    }
    setStatus(book.status);
    const live = liveNumbers(book);
    markAsset = live.asset || markAsset;
    if ($("mark-label")) $("mark-label").textContent = markAsset;
    const paperMode = !!(bookRaw && bookRaw.paper && bookRaw.paper.active)
      || String(bookRaw && (bookRaw.mode || "") || "").toUpperCase() === "PAPER";
    if (paperMode && live.open && live.open.length) {
      const pm = live.open[0];
      $("live-mark").textContent = pm.mark != null ? px(pm.mark) : (live.mark != null ? px(live.mark) : "—");
      if ($("mark-label")) $("mark-label").textContent = String(pm.market || live.asset || "PAPER");
      if ($("mark-age")) $("mark-age").textContent = "paper mark";
    } else {
      const ethMark = (book.marks && book.marks.ETH != null) ? book.marks.ETH : live.mark;
      $("live-mark").textContent = ethMark != null ? px(ethMark) : "—";
      if ($("mark-label")) $("mark-label").textContent = "ETH";
      if ($("mark-age") && book.markSrc) $("mark-age").textContent = String(book.markSrc);
    }
    // Paper: Liquid row = realized paper equity; Funding row = start bankroll
    $("liquid").textContent = money(book.liquidUsd);

    const fund = book.fundingUsd != null ? book.fundingUsd : 0;
    let tp = book.totalPnlUsd;
    if (tp == null && live.equity != null) tp = live.equity - fund;
    let pct = book.totalPnlPct;
    if (pct == null && fund > 0 && tp != null) pct = (tp / fund) * 100;
    else if (pct == null && fund === 0) pct = 0;

    $("funding").textContent = money(fund, fund === 0 ? 0 : 2);
    const tpEl = $("total-pnl");
    if (tpEl) {
      if (tp == null) {
        tpEl.textContent = "—";
      } else {
        const pctS = fund === 0 ? "" : (pct == null ? "" : " (" + (pct >= 0 ? "+" : "") + Number(pct).toFixed(2) + "%)");
        tpEl.textContent = money(tp) + pctS;
      }
      setTone(tpEl, tp);
    }

    const note = $("funding-note");
    if (note) {
      if (book.fundingNote) {
        note.textContent = book.fundingNote;
        note.hidden = false;
      } else {
        note.hidden = true;
      }
    }

    $("upnl").textContent = money(live.upnl);
    setTone($("upnl"), live.upnl);
    $("equity").textContent = money(live.equity);
    if ($("last-updated")) $("last-updated").textContent = book.updatedEt || "—";

    renderHoldings(book);
    renderPositions(live.cards);
    lastFullHist = book.pnlHistory || [];
    renderHist(filterHistRange(lastFullHist, histRange));
    wireHistRange();
    renderTrades(book.trades);
    const fullW = book.wallet || "—";
    $("wallet").textContent = fullW;
    wireWalletCopy(fullW);
    renderPaper(book);
    renderWalletLinks(book);
    $("notes").textContent = book.notes || "—";
    $("src").textContent = bookSrc.replace(/^https?:\/\//, "").slice(0, 42);
    paintAge();
    paintStale();
  }


  function wireWalletCopy(addr) {
    async function copy() {
      if (!addr || addr === "—") return;
      try {
        await navigator.clipboard.writeText(addr);
      } catch (e) {
        const ta = document.createElement("textarea");
        ta.value = addr;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      const tip = $("wallet-copied");
      if (tip) {
        tip.hidden = false;
        clearTimeout(wireWalletCopy._t);
        wireWalletCopy._t = setTimeout(function () { tip.hidden = true; }, 1500);
      }
      ["wallet-copy"].forEach(function (id) {
        const b = $(id);
        if (!b) return;
        const prev = b.textContent;
        b.textContent = "Copied";
        setTimeout(function () { b.textContent = prev; }, 1200);
      });
    }
    ["wallet-copy"].forEach(function (id) {
      const b = $(id);
      if (!b || b.dataset.wired) return;
      b.dataset.wired = "1";
      b.addEventListener("click", copy);
    });
  }


  function renderPaper(book) {
    const panel = $("paper-panel");
    if (!panel) return;
    const paper = book.paper;
    const mode = (book.mode || book.display_mode || "").toString().toUpperCase();
    const active = paper && (paper.active || mode === "PAPER");
    panel.hidden = !active;
    if (!active) return;
    if ($("hero-label")) $("hero-label").textContent = "Paper equity";
    const st = $("status");
    if (st) {
      st.textContent = "PAPER";
      st.className = "status paper";
    }
    const grid = $("paper-grid");
    if (grid) {
      grid.innerHTML = "";
      const cells = [
        ["Start", money(paper.start_equity_usd)],
        ["Equity", money(paper.mtm_equity_usd != null ? paper.mtm_equity_usd : paper.paper_equity_usd)],
        ["Realized", money(paper.realized_pnl_usd)],
        ["uPnL", money(paper.unrealized_pnl_usd)],
        ["Sleeve max", money(paper.sleeve_usd_max)],
        ["Ticket max", money(paper.ticket_usd_max)]
      ];
      cells.forEach(function (c) {
        const d = document.createElement("div");
        d.className = "hold-card";
        d.innerHTML = '<div class="hold-k">' + c[0] + '</div><div class="hold-v">' + c[1] + "</div>";
        grid.appendChild(d);
      });
    }
    const openEl = $("paper-open");
    if (openEl) {
      const o = paper.open;
      if (o) {
        openEl.innerHTML =
          "<strong>" + (o.id || "OPEN") + "</strong> · " +
          (o.side || "") + " " + (o.ticker || "") + " · $" +
          (o.size_usd != null ? o.size_usd : "—") +
          "<br>entry " + (o.entry != null ? Number(o.entry).toFixed(2) : "—") +
          " · MTM " + money(o.mtm_pnl_usd) +
          (o.mtm_pnl_pct != null ? " (" + Number(o.mtm_pnl_pct).toFixed(2) + "%)" : "") +
          "<br>cut " + (o.cut != null ? Number(o.cut).toFixed(2) : "—") +
          " · TP " + (o.tp != null ? Number(o.tp).toFixed(2) : "—") +
          " · " + (o.status || "");
      } else {
        openEl.textContent = "No open paper ticket";
      }
    }
    const q = $("paper-queued");
    if (q) {
      const list = paper.queued || [];
      q.textContent = list.length
        ? "Queued: " + list.map(function (x) { return (x.id || "") + " " + (x.ticker || ""); }).join(", ")
        : "No queued paper";
    }
  }

  function showError(msg) {
    const el = $("err");
    el.hidden = false;
    el.textContent = msg;
    el.className = "err";
    setStatus("RISK");
  }

  async function loadOne(url) {
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
    });
    if (!res.ok) throw new Error(url + " HTTP " + res.status);
    return res.json();
  }

  function pickBestBook(cands) {
    if (!cands.length) return null;
    // Newest stamp wins. Stale CDN "open" must not beat a fresher book.
    const tagged = cands.map(function (c) {
      return { src: c.src, raw: c.raw, t: parseUpdatedEtMs(c.raw), flat: rawIsFlat(c.raw) };
    });
    tagged.sort(function (a, b) { return b.t - a.t; });
    return tagged[0];
  }

  async function refreshBook() {
    let lastErr = null;
    const cands = [];
    const pinned = await loadVersionPinned();
    const list = pinned ? [pinned, "https://cdn.jsdelivr.net/gh/webbeep/desk-pulse@main/book.json"].concat(SOURCES.filter(function (s) { return s !== pinned; })) : SOURCES;
    for (const src of list) {
      try {
        const raw = await loadOne(src);
        cands.push({ src: src, raw: raw });
      } catch (e) {
        lastErr = e;
      }
    }
    const best = pickBestBook(cands);
    if (!best) {
      showError("book.json " + (lastErr && lastErr.message ? lastErr.message : "fail"));
      return;
    }
    bookRaw = best.raw;
    bookSrc = best.src;
    bookAt = Date.now();
    const open = positionsFrom(bookRaw).filter(isOpen);
    if (open.length) markAsset = assetOf(open[0]);
    const bm = normalize(bookRaw).marks || {};
    bookMarks.ETH = bm.ETH != null ? bm.ETH : null;
    bookMarks.BTC = bm.BTC != null ? bm.BTC : null;
    bookMarks.LINK = bm.LINK != null ? bm.LINK : null;
    render();
  }

  function desiredAssets() {
    const set = {};
    if (bookRaw) {
      const open = positionsFrom(bookRaw).filter(isOpen);
      for (const p of open) {
        const a = assetOf(p);
        if (a) set[a] = true;
      }
    }
    if (!Object.keys(set).length) set[markAsset || "ETH"] = true;
    return Object.keys(set).filter(Boolean);
  }

  async function fetchSpot(asset) {
    const url = SPOT[asset];
    if (!url) throw new Error("no spot url for " + asset);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(asset + " HTTP " + res.status);
    const j = await res.json();
    const amt = num(j && j.data && j.data.amount);
    if (amt == null) throw new Error(asset + " no amount");
    return amt;
  }

  async function refreshMark() {
    try {
      if (bookRaw) {
        const open = positionsFrom(bookRaw).filter(isOpen);
        if (open.length) markAsset = assetOf(open[0]);
      }
      const assets = desiredAssets();
      let any = false;
      for (const a of assets) {
        try {
          marks[a] = await fetchSpot(a);
          any = true;
        } catch (e) { /* keep prior */ }
      }
      if (marks[markAsset] != null) {
        liveMark = marks[markAsset];
        markAt = Date.now();
      } else if (bookRaw) {
        const open = positionsFrom(bookRaw).filter(isOpen);
        const bm = open[0] && open[0].mark != null ? open[0].mark : null;
        if (bm != null) {
          liveMark = bm;
          marks[markAsset] = bm;
          markAt = Date.now();
        } else if (!any) {
          throw new Error("no marks");
        }
      } else if (!any) {
        throw new Error("no marks");
      }
      render();
    } catch (e) {
      paintAge();
    }
  }

  if (typeof document !== "undefined") {
    (async function boot() {
      await refreshBook();
      await refreshMark();
    })();
    setInterval(refreshBook, BOOK_MS);
    setInterval(refreshMark, MARK_MS);
    setInterval(function () {
      paintAge();
      paintStale();
    }, 1000);
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
