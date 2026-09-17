# Desk Pulse

Mobile-first dark desk board — holdings, equity, uPnL, total PnL.

## Live URL

**https://webbeep.github.io/desk-pulse/**

Repo: [`webbeep/desk-pulse`](https://github.com/webbeep/desk-pulse) (GitHub Pages from `main` root).

**Not** `webby-box` — do not push or link that owner.

## Files

| File | Role |
|------|------|
| `index.html` | Shell |
| `styles.css` | Mobile-first dark UI |
| `app.js` | Book + marks renderer (~30s refresh) |
| `book.json` | Live desk book (writer SoT) |

## Wallet

- **Primary (V2):** `0x11257A84b997f1f5168300bfA644CFebCAE29C1A`
- Residuals / holdings include **rh_eth** (Robinhood Chain, chainId 4663)
- V2 cutover: `funding_usd = 0` until desk funds this wallet (no legacy −$107 on empty book)

## Data load

1. `./book.json?t=<ms>`
2. `https://cdn.jsdelivr.net/gh/webbeep/desk-pulse@main/book.json`
3. `https://raw.githubusercontent.com/webbeep/desk-pulse/main/book.json`

Auto-refresh **~30s**. Never invent positions or balances. Never put keys/seeds in these files.

## Local

```bash
cd /workspace/desk-pulse-build   # or clone webbeep/desk-pulse
python3 -m http.server 8765
# http://127.0.0.1:8765/
```
