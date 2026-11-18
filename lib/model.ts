// LaunchScope's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// credible pre-token protocols below the floor: the early rows a launch radar exists to find. A
// protocol counts as pre-token when its record carries no token (no market cap, no CoinGecko id, no
// symbol) — the data records none; it never proves none will exist. Wrapped, staked and bridged
// products of another protocol, exchange entries and versioned pools are not launch candidates of
// their own, so the early set applies the watchlist's own product exclusions below the floor too.
//
// Implied value is priced from the snapshot's own market, not from a house constant:
//
//   peers       = the snapshot's token-bearing protocols with a real market cap (>= $1M) and TVL
//   multiple(c) = the median market-cap/TVL of category c's peers, winsorised to [0.005, 10] and
//                 shrunk toward the global median with a pseudo-count of 3, then clamped to
//                 [0.02, 2.5]; a category with no peers prices at the global median
//   momentum    = 1 + clamp(change_7d, -50, +100) / 100 x 0.4      (a week of TVL flow, damped)
//   maturity    = 0.65 + 0.35 x min(age_days, 1095) / 1095         (unknown age prices as 365 days)
//   breadth     = 1 + 0.03 x min(chains - 1, 8)                    (distribution across chains)
//   implied     = round(tvl_usd x multiple(category) x momentum x maturity x breadth)
//
// Every factor is printed on the board, so a reader can disagree with any one of them and reprice.
// No protocol name is ever special-cased: the same function scores every row, and the run is fully
// deterministic — ages come from the snapshot's own as_of date, never from the wall clock.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated here and in the dashboard so the pricing can be audited. */
export interface ModelConstants {
  peer_min_mcap_usd: number;
  winsor_lo: number;
  winsor_hi: number;
  shrink_pseudo_count: number;
  multiple_lo: number;
  multiple_hi: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
}

export const MODEL: ModelConstants = {
  peer_min_mcap_usd: 1_000_000,
  winsor_lo: 0.005,
  winsor_hi: 10,
  shrink_pseudo_count: 3,
  multiple_lo: 0.02,
  multiple_hi: 2.5,
  momentum_weight: 0.4,
  momentum_floor: -50,
  momentum_cap: 100,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_extra_chains: 8,
};

/** The model's version label: the dashboard names it and the board carries it. */
export const MODEL_VERSION = 'scope-2';

/** How many live-token protocols the dashboard's peer strip carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's peer evidence: how many launched peers priced it, and the multiple in force. */
export interface PeerStat {
  category: string;
  peers: number;
  raw_median: number | null;
  multiple: number;
}

/** The factor breakdown one board row was priced with. */
export interface RowModel {
  category_multiple: number;
  peer_count: number;
  global_multiple: number;
  momentum_pct: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: RowModel;
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row, its factors and its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  peer_count: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the peer evidence and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  peer_protocols: number;
  universe_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  peers: PeerStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a product of another protocol or an exchange, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A whole word that marks a wrapped or staked product of another asset. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Names that begin with an exchange's name are that exchange's product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a protocol is a credible launch candidate in its own right: it records no token, and it is
 * not a wrapped, staked or bridged product of another protocol, an exchange entry or a versioned
 * pool. This is the watchlist's own product test, applied at any size.
 */
export function isCredible(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The median of a non-empty list, taken on a sorted copy. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The peer evidence: for every category, the launched protocols that price it. A peer is a
 * token-bearing protocol with a market cap of at least the model's floor and a TVL to divide by;
 * its multiple is winsorised so one broken print cannot price a whole category.
 */
export function peerStats(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; peers: number; byCategory: Map<string, PeerStat> } {
  const lists = new Map<string, number[]>();
  let all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd < model.peer_min_mcap_usd || p.tvl_usd <= 0) continue;
    const multiple = clamp(p.mcap_usd / p.tvl_usd, model.winsor_lo, model.winsor_hi);
    all.push(multiple);
    const key = p.category ?? 'Uncategorised';
    const list = lists.get(key) ?? [];
    list.push(multiple);
    lists.set(key, list);
  }
  const global = all.length > 0 ? median(all) : 0.25;
  const byCategory = new Map<string, PeerStat>();
  for (const [category, list] of lists) {
    const raw = median(list);
    const shrunk = (list.length * raw + model.shrink_pseudo_count * global) / (list.length + model.shrink_pseudo_count);
    byCategory.set(category, { category, peers: list.length, raw_median: round4(raw), multiple: round4(clamp(shrunk, model.multiple_lo, model.multiple_hi)) });
  }
  return { global: round4(global), peers: all.length, byCategory };
}

/** The multiple one protocol is priced with: its category's, or the global median when it has no peers. */
function multipleFor(p: SnapshotProtocol, stats: ReturnType<typeof peerStats>, model: ModelConstants): { multiple: number; peerCount: number } {
  const stat = p.category === null ? undefined : stats.byCategory.get(p.category);
  if (stat !== undefined) return { multiple: stat.multiple, peerCount: stat.peers };
  return { multiple: clamp(stats.global, model.multiple_lo, model.multiple_hi), peerCount: 0 };
}

/** Every factor and the implied value one protocol gets under `model`. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  stats: ReturnType<typeof peerStats>,
  model: ModelConstants = MODEL,
): { implied: number; model: RowModel } {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, peerCount } = multipleFor(p, stats, model);
  const momentumPct = clamp(finite(p.change_7d, 0), model.momentum_floor, model.momentum_cap);
  const momentumMult = 1 + (momentumPct / 100) * model.momentum_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra_chains);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentumMult * maturityMult * breadthMult));
  return {
    implied,
    model: {
      category_multiple: multiple,
      peer_count: peerCount,
      global_multiple: stats.global,
      momentum_pct: round4(momentumPct),
      momentum_multiplier: round4(momentumMult),
      maturity_multiplier: round4(maturityMult),
      breadth_multiplier: round4(breadthMult),
      age_days: age,
    },
  };
}

// ------------------------------------------------------------------ farm plans

/** The working group a category farms like; the plan's actions follow the group, not the label. */
type FarmGroup = 'lending' | 'dex' | 'derivatives' | 'bridge' | 'yield' | 'staking' | 'rwa' | 'stable' | 'prediction' | 'launchpad' | 'chain' | 'payments' | 'other';

function groupOf(category: string | null): FarmGroup {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity manager')) return 'dex';
  if (c.includes('derivative') || c.includes('option') || c.includes('perpetual')) return 'derivatives';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak') || c.includes('anchor btc') || c.includes('decentralized btc')) return 'staking';
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('leveraged farm') || c === 'farm' || c.includes('basis')) return 'yield';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('stable') || c.includes('reserve currency')) return 'stable';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('launchpad')) return 'launchpad';
  if (c === 'chain') return 'chain';
  if (c.includes('payment') || c.includes('card') || c.includes('cedefi')) return 'payments';
  return 'other';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One step as a single board string: the action, then its cost and its time. */
function step(action: string, cost: string, time: string): string {
  let s = `${action} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  return s;
}

/** The group's core position and its second surface, in the words a farmer can follow. */
function coreActions(group: FarmGroup, p: SnapshotProtocol, capital: number, chain: string, chain2: string | null): [string, string] {
  const n = p.name;
  switch (group) {
    case 'lending':
      return [
        `Supply $${capital} of USDC to ${n} on ${chain}, then borrow a modest amount against it and re-supply the borrow once, so both sides of the market see the wallet.`,
        `Repay and re-borrow a small tranche every couple of weeks to keep the loop live, and never let the health factor drift near liquidation.`,
      ];
    case 'dex':
      return [
        `Provide $${capital} of liquidity to ${n}'s busiest pool on ${chain}, split across the pair's two assets, and keep the LP position open.`,
        `Route a few swaps a week through ${n} itself rather than an aggregator, so the wallet builds both LP and trader history.`,
      ];
    case 'derivatives':
      return [
        `Deposit $${capital} of USDC as margin on ${n} and open one small, hedged position; size it to survive a bad week, not to win one.`,
        `Trade a small contract each week and use one advanced feature (a limit order, a vault or a sub-account) so the activity is not one-dimensional.`,
      ];
    case 'bridge':
      return [
        `Bridge $${capital} of USDC from Ethereum to ${chain2 ?? chain} through ${n}, then bridge a smaller amount back a few days later.`,
        `Use the bridged funds in one app on the destination chain instead of bridging straight back, so the trip reads as real usage.`,
      ];
    case 'yield':
      return [
        `Deposit $${capital} into a flagship ${n} vault on ${chain} and keep the vault shares in the same wallet that deposited.`,
        `Split a second, smaller deposit across another ${n} vault or strategy, and rebalance once a month rather than chasing weekly yield changes.`,
      ];
    case 'staking':
      return [
        `Stake $${capital} of the underlying asset through ${n} on ${chain} and hold the receipt position without wrapping or moving it on.`,
        `Claim and re-stake any staking rewards inside ${n} itself, so the compounding happens on the protocol's own books.`,
      ];
    case 'rwa':
      return [
        `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} through its own app and hold it past at least one distribution cycle.`,
        `Complete the protocol's investor or KYC steps early if it asks for them, and keep a small second mint on the calendar each month.`,
      ];
    case 'stable':
      return [
        `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold the position rather than swapping straight back out.`,
        `Use the stable asset in one partner app ${n} lists (a lending market or a DEX pool), so the wallet shows both mint and circulation activity.`,
      ];
    case 'prediction':
      return [
        `Fund $${capital} on ${n} and place small positions in several markets instead of one large bet, favouring markets that settle within the month.`,
        `Come back to settle finished positions promptly and roll the proceeds into new markets, building a steady participation record.`,
      ];
    case 'launchpad':
      return [
        `Register the wallet with ${n} and take part in one live launch with $${capital}, completing every step the launch page asks for.`,
        `Hold at least part of any allocation rather than selling on day one, and join the next launch window when it opens.`,
      ];
    case 'chain':
      return [
        `Bridge $${capital} of USDC onto ${chain} and make it the wallet's home chain for a month: pay gas, swap and save there weekly.`,
        `Use three different native apps on ${chain} (a DEX, a lending market and one local app) so the wallet's activity is broad, not scripted.`,
      ];
    case 'payments':
      return [
        `Onboard $${capital} through ${n} on ${chain} and run ordinary payment-sized transactions rather than one large transfer.`,
        `Keep a balance parked with ${n} between transactions and use its card or payment rail for a few real purchases if it offers one.`,
      ];
    default:
      return [
        `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open past the first week.`,
        `Use a second feature of ${n} (a different market, pool or module) with a smaller amount, so the wallet is not a single-transaction visitor.`,
      ];
  }
}

/**
 * A protocol's farm plan: six steps built from its own record — its category's working group, its
 * first chains, a capital size from its TVL and a hold window from its age. The steps position for a
 * potential launch; they promise nothing, and step five says so in as many words.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const group = groupOf(p.category);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const chain2 = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [core, second] = coreActions(group, p, capital, chain, chain2);
  const breadthNote = p.chains.length > 2 ? ` ${p.name} also runs on ${p.chains[1]} and ${p.chains[2]}, so repeat the core position on one of them later.` : '';
  return [
    step(
      `Set up a fresh wallet for ${p.name} that holds only the funds you plan to farm, keep its seed phrase offline, and send a small test transaction on ${chain} first.`,
      'under $3 of gas for the test',
      '10 minutes',
    ),
    step(core, `$${capital} of capital plus a few dollars of gas`, '15 minutes to set up'),
    step(second + breadthNote, 'a few dollars of gas', '10 minutes a week'),
    step(
      `Hold the position for at least ${hold} days and make one qualifying action each week, so the wallet appears in several weekly snapshots instead of a single spike.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    step(
      `Check ${p.name}'s own points, rewards or governance page before withdrawing, and claim only from links the protocol itself publishes; a launch is a possibility to position for, never a promise, and no genuine claim ever asks for a fee or a seed phrase.`,
      'nothing to check, and never pay to claim',
      '10 minutes',
    ),
    step(
      `Log the wallet, the dates and every transaction hash in a farm log, and take one governance or community action (a vote, a forum post or a feedback form) if ${p.name} runs one.`,
      'nothing but the log',
      '15 minutes',
    ),
  ];
}

// ------------------------------------------------------------------ the board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const stats = peerStats(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is on the board, whatever the model thinks of it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every credible pre-token protocol below the floor. The set is small enough to
  // carry whole (178 rows on this snapshot), so no candidate is cut by an arbitrary cap.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && isCredible(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const { implied, model: rowModel } = impliedValue(p, snapshot.as_of, stats, model);
    return { p, implied, rowModel };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.has(s.p.slug),
    age_days: s.rowModel.age_days,
    implied_value_usd: s.implied,
    model: s.rowModel,
    farm_steps: farmSteps(s.p, s.rowModel.age_days),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's peer strip. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js: the row, its factors and its farm plan. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    peer_count: row.model.peer_count,
    momentum_multiplier: row.model.momentum_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const stats = peerStats(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const peers = [...stats.byCategory.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: stats.global,
    peer_protocols: stats.peers,
    universe_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    peers,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
