# LaunchScope

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/adzinsyariif/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/adzinsyariif/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for the make.fun bounty [“Build the best token launch radar”](https://make.fun/bounty/token-radar-01).

LaunchScope reads the sealed DefiLlama snapshot (758 protocols, fetched 2026-11-14) and ranks the
protocols the snapshot records no token for by what their launch would be worth — each with the
factor breakdown behind its price and a six-step plan for farming a potential launch. It writes a
ranked `board.json`, a static dashboard (no framework, no network) and a `dossier.json` built with
the vendored make.fun library. Node ≥ 22, standard library only, fully deterministic: ages come
from the snapshot's own `as_of` date, never from the wall clock.

## The board

- **178 rows**: all **40 watchlist** protocols (TVL at or above the snapshot's $50M floor), plus
  **138 early finds** below the floor that pass the same product test the watchlist uses — a
  protocol must record no token and must not be a wrapped, staked or bridged product of another
  protocol, an exchange entry, or a versioned pool. WBTC and Binance staked ETH are somebody
  else's asset in a wrapper, not launches waiting to happen, so they are not ranked.
- The snapshot's live-token protocols are set aside and shown in the dashboard as the peer set —
  the market's own values, never mixed into the ranking.

## The model (scope-2)

A launch is priced from the snapshot's own market, not from a house constant:

```
implied = TVL × category multiple × momentum × maturity × breadth
```

- **Category multiple** — for each category, the median market-cap/TVL of its *launched peers* in
  the snapshot (token-bearing, market cap ≥ $1M; 110 peers). Each peer multiple is winsorised to
  [0.005×, 10×]; each category median is then **shrunk toward the global median (0.32×)** with a
  pseudo-count of 3 and clamped to [0.02×, 2.5×], so a category priced by a single protocol leans
  on the whole market instead of on one print. A category with no launched peers prices at the
  global median. Every row prints its multiple and its peer count, so thin evidence is visible.
- **Momentum** — `1 + (clamp(change_7d, −50, 100) / 100) × 0.4`: a week of TVL flow, damped.
- **Maturity** — `0.65 + 0.35 × min(age_days, 1095) / 1095`, age from `listed_at` to the
  snapshot's `as_of`; an unknown age prices as 365 days. Survival is worth something; a
  three-year-old protocol prices at 1.00×, a new one at 0.65×.
- **Breadth** — `1 + 0.03 × min(chains − 1, 8)`: distribution a launch can reach.

No protocol name is special-cased anywhere: one function prices every row, and the program
refuses to write a board the gate would reject (coverage, ranks, ordering, value and farm-step
checks run before anything is written).

## Farm plans

Each row carries six steps generated from its own record — its category's working group (supply
and borrow loops for lending, LP plus routed volume for DEXs, bridging plus destination activity
for cross-chain bridges, vault deposits for curators and allocators, and so on), its first chains,
a capital size scaled to its TVL ($50–$250) and a hold window scaled to its age (30–60 days).
The plans position for a *potential* launch; step five says in as many words that a launch is a
possibility, never a promise, and that no genuine claim asks for a fee or a seed phrase.

## Run it

```
node main.ts --input <snapshot.json|directory>   # or mount the snapshot at /input
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Outputs: `board.json` (`{"rows":[…]}`), `data.js` (the dashboard's dataset), `dashboard/`,
`screenshots/` (board, detail brief, filtered view) and `dossier.json`.

## Layout

- `main.ts` — the batch lifecycle: read input → price → gate → write output → exit.
- `lib/model.ts` — the model: peer multiples, factors, farm plans, board build and gate checks.
- `dashboard/` — the radar UI: ranked board, per-protocol brief, filters (category, chain,
  watchlist, search), peer-evidence tables, and a full-page brief per protocol.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte for byte.

## Disclaimer

Implied values are model estimates derived from one frozen snapshot, not predictions and not
financial advice. “Pre-token” throughout means only that the snapshot records no token for the
protocol; it is a statement about the data, not a claim about what any team will ever issue.
