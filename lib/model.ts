// Token Radar's model, version radar-2.
//
// A sealed snapshot goes in and a ranked board comes out. The board takes every
// slug on the snapshot's watchlist as its floor, never its ceiling, and then it
// adds every other pre-token protocol the house rule would rank: no token on
// record, not a wrapped, staked or bridged product, not a versioned pool, not
// an exchange. The snapshot's live-token protocols are kept apart and shown with
// the market's own values, never mixed into the ranked board.
//
// Implied value is a power law the program fits from the snapshot itself, never
// a flat multiple of TVL:
//
//   log(mcap) = a + b * log(tvl_usd)              fitted by least squares on the
//   base      = exp(a + b * log(tvl_usd))          snapshot's live-token set
//   growth    = clamp(change_7d, -50, 100) percent (a market cap above zero,
//   growthMult = 1 + (growth / 100) * 0.4           not an exchange)
//   maturity  = 0.7 + min(age_days, 1095) / 1095 * 0.3
//   implied   = max(1, round(base * growthMult * maturity))
//   (age_days unknown: 365 days)
//
// Why a power law and not a multiple: on this snapshot a live-token protocol's
// market cap grows far more slowly than its TVL (the log-log slope is about
// 0.47, and log TVL correlates about -0.42 with log mcap/TVL), so a flat
// multiple overstates the biggest protocols and understates the small ones.
// The fit is computed at run time from the input, and the program checks it
// with a leave-one-out backtest over the same live-token set before it scores
// a single row. The dashboard states the fitted slope and intercept and the
// backtest's numbers, so a reader can see what the model claims and how far it
// has ever been wrong. No protocol name is ever special-cased: one function
// scores every row.

/**
 * One protocol as the sealed snapshot records it. These ten fields are the
 * whole shape the snapshot carries for a protocol; nothing else is read.
 */
export interface SnapshotProtocol {
  /** DefiLlama slug: the protocol's key in the snapshot and on the board. */
  slug: string;
  /** Display name, exactly as the snapshot records it. */
  name: string;
  /** DefiLlama category, or null when the snapshot records none. */
  category: string | null;
  /** Chains the protocol runs on; empty when the snapshot names none. */
  chains: string[];
  /** Total value locked, in dollars. */
  tvl_usd: number;
  /** Seven-day TVL change in percent, or null when the snapshot has none. */
  change_7d: number | null;
  /** Market cap in dollars, or null: null is what makes a protocol pre-token. */
  mcap_usd: number | null;
  /** First listing date (YYYY-MM-DD), or null when the snapshot has none. */
  listed_at: string | null;
  /** CoinGecko id, or null when the protocol has no listed token. */
  gecko_id: string | null;
  /** Token symbol, or null when the protocol has no token. */
  symbol: string | null;
}

/** The whole snapshot document: its date, its source, its floor, its protocols. */
export interface Snapshot {
  /** The snapshot's date, YYYY-MM-DD. */
  as_of: string;
  /** Where the snapshot came from: the protocol index it was taken from. */
  source: string;
  /** The watchlist floor in dollars: TVL at or above this is on the watchlist. */
  floor_usd: number;
  /** Every protocol the snapshot carries, watchlist or not. */
  protocols: SnapshotProtocol[];
  /** Slugs on the watchlist, in the order the snapshot lists them. */
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. The fit itself is computed, never written in. */
export interface ModelConstants {
  /** A 100% weekly gain lifts implied value by this fraction (0.4 = 40%). */
  growth_weight: number;
  /** The weekly change is never counted below this many percent. */
  growth_floor: number;
  /** The weekly change is never counted above this many percent. */
  growth_cap: number;
  /** The maturity multiplier of a protocol listed yesterday. */
  maturity_floor: number;
  /** What three years of age add to the maturity multiplier. */
  maturity_range: number;
  /** Age in days at which the maturity multiplier stops growing. */
  maturity_days: number;
  /** Age in days assumed when the snapshot records no listing date. */
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The least-squares fit of log(mcap) on log(tvl) over the snapshot's live-token set. */
export interface PowerLawFit {
  /** The fit's intercept: log(mcap) when log(tvl) is zero. */
  intercept: number;
  /** The fit's slope: how fast log(mcap) grows with log(tvl). */
  slope: number;
  /** How many live-token protocols the fit learned from. */
  n: number;
}

/** The leave-one-out backtest of the fitted law against the same live-token set. */
export interface Backtest {
  /** How many live-token protocols were predicted. */
  n: number;
  /** Median absolute log error of the predictions, to three decimals. */
  median_abs_log_error: number;
  /** Percent of predictions within twice the real market cap. */
  within_2x_pct: number;
  /** Percent of predictions within three times the real market cap. */
  within_3x_pct: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  /** What to do, in the words a farmer can follow. */
  text: string;
  /** What it costs, in dollars of capital or gas. */
  cost: string;
  /** How long it takes, from minutes to days. */
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  /** One-based position on the ranked board. */
  rank: number;
  /** DefiLlama slug. */
  slug: string;
  /** Display name. */
  name: string;
  /** DefiLlama category, or null. */
  category: string | null;
  /** Chains the protocol runs on. */
  chains: string[];
  /** Total value locked, in dollars. */
  tvl_usd: number;
  /** Seven-day TVL change in percent, or null. */
  change_7d: number | null;
  /** Market cap in dollars, or null: null on every board row. */
  mcap_usd: number | null;
  /** First listing date, or null. */
  listed_at: string | null;
  /** CoinGecko id, or null: null on every board row. */
  gecko_id: string | null;
  /** Token symbol, or null: null on every board row. */
  symbol: string | null;
  /** Every board row is a protocol with no token. */
  token_status: 'pre-token';
  /** Whole days from first listing to the snapshot, or null. */
  age_days: number | null;
  /** The row's implied value in whole dollars. */
  implied_value_usd: number;
  /** The model's own inputs for this row, so the dashboard can show its working. */
  model: {
    /** Power-law base value in whole dollars: exp(a + b * ln(tvl)). */
    fit_base_usd: number;
    /** Weekly change in percent after the clamp. */
    growth_pct: number;
    /** The growth multiplier applied to the base. */
    growth_multiplier: number;
    /** The maturity multiplier applied to the base. */
    maturity_multiplier: number;
    /** Whole days from first listing to the snapshot, or null. */
    age_days: number | null;
    /** Live-token protocols in this row's category. */
    category_live_peers: number;
    /** Median market cap of those peers, or null when there are none. */
    category_median_mcap_usd: number | null;
  };
  /** The row's farm plan: six steps, each one string. */
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  /** One-based position on the ranked board. */
  rank: number;
  /** DefiLlama slug. */
  slug: string;
  /** Display name. */
  name: string;
  /** DefiLlama category, or null. */
  category: string | null;
  /** Chains the protocol runs on. */
  chains: string[];
  /** Total value locked, in dollars. */
  tvl_usd: number;
  /** Seven-day TVL change in percent, or null. */
  change_7d: number | null;
  /** Market cap in dollars, or null. */
  mcap_usd: number | null;
  /** First listing date, or null. */
  listed_at: string | null;
  /** Whole days from first listing to the snapshot, or null. */
  age_days: number | null;
  /** The row's implied value in whole dollars. */
  implied_value_usd: number;
  /** Power-law base value in whole dollars. */
  fit_base_usd: number;
  /** The growth multiplier applied to the base. */
  growth_multiplier: number;
  /** The maturity multiplier applied to the base. */
  maturity_multiplier: number;
  /** Live-token protocols in this row's category. */
  category_live_peers: number;
  /** Median market cap of those peers, or null when there are none. */
  category_median_mcap_usd: number | null;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  /** DefiLlama slug. */
  slug: string;
  /** Display name. */
  name: string;
  /** DefiLlama category, or null. */
  category: string | null;
  /** Chains the protocol runs on. */
  chains: string[];
  /** Total value locked, in dollars. */
  tvl_usd: number;
  /** Market cap in dollars, or null. */
  mcap_usd: number | null;
  /** Seven-day TVL change in percent, or null. */
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit and its backtest. */
export interface RadarData {
  /** The snapshot's date. */
  as_of: string;
  /** Where the snapshot came from. */
  source: string;
  /** The watchlist floor in dollars. */
  floor_usd: number;
  /** The model's constants. */
  model: ModelConstants;
  /** The model's version label. */
  model_version: string;
  /** The power-law fit the board was scored with. */
  fit: PowerLawFit;
  /** The leave-one-out backtest of that fit. */
  backtest: Backtest;
  /** How many slugs the watchlist holds. */
  watchlist_size: number;
  /** How many rows the board holds. */
  board_size: number;
  /** How many board rows sit below the watchlist floor. */
  early_size: number;
  /** How many live-token protocols the Live token view holds. */
  live_size: number;
  /** The board in compact form. */
  rows: RadarRow[];
  /** The live-token protocols, by market cap. */
  live: LiveRow[];
}

/** Refused snapshots: thrown whenever the input is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Milliseconds in one day: the unit ageDays divides by. */
const DAY_MS = 86_400_000;

/** A usable number, or `fallback` when the value is missing or not finite. */
function finite(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when either date is missing or unparsable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(listedMs) || !Number.isFinite(asOfMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
}

/** The live-token protocols the fit learns from: a market cap above zero, not an exchange. */
export function liveTokenSet(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
}

/**
 * The power law, fitted by least squares on log(mcap) against log(tvl) over the
 * live-token set. Refused when the set is too small to fit: a model that cannot
 * learn from the snapshot is not a model of it.
 *
 * The sums are accumulated in snapshot order, one pass, because the order of the
 * additions is part of the arithmetic: reordering them would move the fit.
 */
export function fitPowerLaw(protocols: SnapshotProtocol[]): PowerLawFit {
  const live = liveTokenSet(protocols);
  if (live.length < 10) throw new SnapshotError(`only ${live.length} live-token protocols to fit the power law`);
  let sumLogTvl = 0;
  let sumLogMcap = 0;
  for (const p of live) {
    sumLogTvl += Math.log(p.tvl_usd);
    sumLogMcap += Math.log(p.mcap_usd as number);
  }
  const n = live.length;
  const meanLogTvl = sumLogTvl / n;
  const meanLogMcap = sumLogMcap / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of live) {
    const dx = Math.log(p.tvl_usd) - meanLogTvl;
    const dy = Math.log(p.mcap_usd as number) - meanLogMcap;
    sxy += dx * dy;
    sxx += dx * dx;
  }
  if (sxx <= 0) throw new SnapshotError('live-token TVLs do not vary enough to fit the power law');
  const slope = sxy / sxx;
  const fitted: PowerLawFit = { intercept: meanLogMcap - slope * meanLogTvl, slope, n };
  return fitted;
}

/** The fit's value for one TVL, in whole dollars. */
export function fitValue(fit: PowerLawFit, tvlUsd: number): number {
  return Math.exp(fit.intercept + fit.slope * Math.log(tvlUsd));
}

/**
 * Leave-one-out backtest: each live-token protocol is predicted by a fit that
 * never saw it, with the same growth and maturity multipliers the board
 * applies. The numbers are the model's honest error on the only ground truth
 * the snapshot carries.
 */
export function backtestFit(protocols: SnapshotProtocol[], model: ModelConstants, asOf: string): Backtest {
  const live = liveTokenSet(protocols);
  const errors: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const rest = live.filter((_, j) => j !== i);
    const fit = fitPowerLaw(rest);
    const heldOut = live[i]!;
    const { implied } = impliedValue(heldOut, asOf, model, fit);
    errors.push(Math.abs(Math.log(implied / (heldOut.mcap_usd as number))));
  }
  errors.sort((a, b) => a - b);
  const median = errors[Math.floor(errors.length / 2)]!;
  const within = (factor: number): number => (errors.filter((e) => e <= Math.log(factor)).length / errors.length) * 100;
  const result: Backtest = {
    n: errors.length,
    median_abs_log_error: Math.round(median * 1000) / 1000,
    within_2x_pct: Math.round(within(2) * 10) / 10,
    within_3x_pct: Math.round(within(3) * 10) / 10,
  };
  return result;
}

/** The three multipliers and the implied value one protocol gets under the fitted law. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: PowerLawFit,
): { implied: number; base: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  // A missing seven-day change counts as flat: no weekly move, no adjustment.
  const weeklyChange = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, weeklyChange));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const settledAge = age ?? model.unknown_age_days;
  const cappedAge = Math.min(Math.max(settledAge, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (cappedAge / model.maturity_days) * model.maturity_range;
  const base = fitValue(fit, protocol.tvl_usd);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, base, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/; // trailing "V2", "v3" or "2.0" marks a versioned pool
/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name that begins with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  const noMarketCap = p.mcap_usd === null && p.gecko_id === null;
  return noMarketCap && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 * staked or bridged product of a token that already trades, not a versioned
 * pool, not an exchange. This is the house's own watchlist rule, applied to
 * the protocols below the floor as well.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (WRAPPED_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocols keyed by slug, for the watchlist lookup. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** The median of a list of numbers, or null when it holds none. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** The live-token peers in one protocol's category: how many, and their median market cap. */
export function categoryPeers(protocol: SnapshotProtocol, live: SnapshotProtocol[]): { count: number; medianMcap: number | null } {
  if (protocol.category === null) return { count: 0, medianMcap: null };
  const mcaps = live.filter((p) => p.category === protocol.category).map((p) => p.mcap_usd as number);
  return { count: mcaps.length, medianMcap: median(mcaps) };
}

/**
 * The protocols the board ranks, in the order they were chosen: every watchlist
 * slug first, in watchlist order, then every other pre-token protocol the house
 * rule would rank, in snapshot order. The watchlist is the floor, and a missing
 * watchlist record would break the board's coverage, so it is never gambled on.
 */
function selectBoardProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  return [...chosen.values()];
}

/** One scored protocol: the protocol, its implied value, its multipliers and its peers. */
interface ScoredProtocol {
  p: SnapshotProtocol;
  implied: number;
  base: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  peers: { count: number; medianMcap: number | null };
}

/** The strongest implied value first; equal values keep the tie-break below. */
function compareScored(a: ScoredProtocol, b: ScoredProtocol): number {
  return b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.slug ? 1 : 0);
}

/** One scored protocol as a board row, with the model's inputs nested inside. */
function toBoardRow(entry: ScoredProtocol, index: number): BoardRow {
  const protocol = entry.p;
  return {
    rank: index + 1, // one-based position on the ranked board
    slug: protocol.slug, // DefiLlama slug
    name: protocol.name, // display name
    category: protocol.category, // DefiLlama category, or null
    chains: protocol.chains, // chains the protocol runs on
    tvl_usd: protocol.tvl_usd, // total value locked, in dollars
    change_7d: protocol.change_7d, // seven-day TVL change, or null
    mcap_usd: protocol.mcap_usd, // market cap, or null on every board row
    listed_at: protocol.listed_at, // first listing date, or null
    gecko_id: protocol.gecko_id, // CoinGecko id, or null on every board row
    symbol: protocol.symbol, // token symbol, or null on every board row
    token_status: 'pre-token', // every board row is a protocol with no token
    age_days: entry.age, // whole days from first listing, or null
    implied_value_usd: entry.implied, // the row's implied value in whole dollars
    model: {
      fit_base_usd: Math.round(entry.base), // power-law base, rounded to whole dollars
      growth_pct: entry.growthPct, // weekly change after the clamp
      growth_multiplier: round4(entry.growthMult), // the growth multiplier applied
      maturity_multiplier: round4(entry.maturityMult), // the maturity multiplier applied
      age_days: entry.age, // whole days from first listing, or null
      category_live_peers: entry.peers.count, // live-token peers in the category
      category_median_mcap_usd: entry.peers.medianMcap === null ? null : Math.round(entry.peers.medianMcap), // their median market cap
    },
    farm_steps: farmSteps(protocol, entry.age).map(stepText), // the row's six-step farm plan
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitPowerLaw(snapshot.protocols);
  const live = liveTokenSet(snapshot.protocols);
  const chosen = selectBoardProtocols(snapshot);
  const scored: ScoredProtocol[] = chosen.map((p) => {
    const value = impliedValue(p, snapshot.as_of, model, fit);
    return {
      p,
      implied: value.implied,
      base: value.base,
      growthPct: value.growthPct,
      growthMult: value.growthMult,
      maturityMult: value.maturityMult,
      age: value.age,
      peers: categoryPeers(p, live),
    };
  });
  scored.sort(compareScored);
  return scored.map(toBoardRow);
}

/** Round to four decimal places: the dashboard shows multipliers to four figures. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  const joined = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (joined.length > 600) return `${joined.slice(0, 596)}...`;
  if (joined.length < 20) return `${joined} Hold the position and check the protocol's own page.`;
  return joined;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  // Larger protocols get a larger position: the capital follows the TVL tiers.
  const tiers: Array<[number, number]> = [
    [5_000_000_000, 250],
    [1_000_000_000, 150],
    [100_000_000, 100],
  ];
  for (const [floor, capital] of tiers) {
    if (p.tvl_usd >= floor) return capital;
  }
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30; // no listing date: a month is the neutral hold
  if (age < 180) return 60; // under six months old: two months
  if (age < 365) return 45; // under a year old: six weeks
  return 30; // a year or older: a month
}

/**
 * The category's first action, in the words a farmer can follow. The table is
 * read top to bottom and the first entry whose words match the category wins,
 * so the order below is the decision. The wording of each action is the plan
 * the board carries, and no protocol name is ever special-cased.
 */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  const name = p.name;
  const table: Array<{ words: string[]; write: (capital: number, name: string, chain: string) => string }> = [
    { words: ['lend', 'cdp', 'collateral'], write: (c, n, ch) => `Supply $${c} of USDC to ${n} on ${ch} and keep the position open.` },
    { words: ['dex', 'yield', 'leveraged farm', 'liquidity manager'], write: (c, n, ch) => `Provide $${c} of liquidity to ${n}'s main pool on ${ch} and keep the position open.` },
    { words: ['bridge'], write: (c, n, ch) => `Bridge $${c} of USDC to ${ch} through ${n} and use the bridged funds in its app.` },
    { words: ['staking', 'restak'], write: (c, n, ch) => `Stake $${c} of the chain's staking asset through ${n} and keep the receipt.` },
    { words: ['perpetual', 'derivative', 'options'], write: (c, n, ch) => `Deposit $${c} of USDC as margin on ${n} and open one small hedge.` },
    { words: ['prediction'], write: (c, n, _ch) => `Fund $${c} and place one market position on ${n}.` },
    { words: ['curator', 'allocator', 'risk'], write: (c, n, ch) => `Deposit $${c} into a ${n} vault on ${ch} and keep the shares.` },
    { words: ['stable'], write: (c, n, ch) => `Mint or deposit $${c} of the stable asset through ${n} on ${ch}.` },
    { words: ['rwa'], write: (c, n, ch) => `Mint $${c} of the protocol's yield asset on ${ch} and hold it.` },
    { words: ['insurance'], write: (c, n, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy.` },
    { words: ['launchpad'], write: (c, n, ch) => `Join ${n}'s next sale on ${ch} with $${c} and hold the allocation.` },
    { words: ['farm'], write: (c, n, ch) => `Deposit $${c} into ${n}'s farm on ${ch} and keep the position open.` },
  ];
  for (const entry of table) {
    if (entry.words.some((w) => category.includes(w))) return entry.write(capital, name, chain);
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second action: a different move a week later, so the wallet is not one-note. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  const table: Array<{ words: string[]; write: (small: number, name: string, chain: string) => string }> = [
    { words: ['lend', 'cdp', 'collateral'], write: (s, n, _ch) => `Borrow $${s} against the supply on ${n}, then repay it, so the wallet shows both sides of the market.` },
    { words: ['dex', 'yield', 'leveraged farm', 'liquidity manager'], write: (s, n, ch) => `Add $${s} to a second pool on ${n} on ${ch}, so the wallet is not a one-pool farmer.` },
    { words: ['bridge'], write: (_s, _n, _ch) => `Use the bridged funds once in the destination app instead of bridging straight back.` },
    { words: ['staking', 'restak'], write: (_s, _n, _ch) => `Check the unstaking queue and the receipt token's peg before adding any more.` },
    { words: ['perpetual', 'derivative', 'options'], write: (_s, _n, _ch) => `Close the hedge after one week and open a fresh one, so the position is never stale.` },
    { words: ['prediction'], write: (_s, _n, _ch) => `Let the first market settle before funding a second one.` },
    { words: ['curator', 'allocator', 'risk'], write: (_s, _n, _ch) => `Read the vault's allocation report before the second deposit.` },
    { words: ['stable'], write: (_s, _n, _ch) => `Check the peg and the redemption route before adding more.` },
    { words: ['rwa'], write: (_s, _n, _ch) => `Read the redemption terms and the custodian note before adding more.` },
    { words: ['insurance'], write: (_s, _n, _ch) => `Read the cover wording and the claim window before renewing.` },
    { words: ['launchpad'], write: (_s, _n, _ch) => `Vote or complete the sale's checklist before the next allocation opens.` },
    { words: ['farm'], write: (_s, _n, _ch) => `Harvest the first rewards and restake them instead of selling.` },
  ];
  for (const entry of table) {
    if (entry.words.some((w) => category.includes(w))) return entry.write(small, name, chain);
  }
  return `Make a second, smaller deposit in a different week so the activity spans two snapshots.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The
 * plan is derived from the protocol's own record (category, chains, TVL, age),
 * never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const first = actionFor(p, capital, chain);
  const second = secondActionFor(p, capital, chain);
  const step = (text: string, cost: string, time: string): FarmStep => ({ text, cost, time });
  return [
    step(
      'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ),
    step(first, `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, '15 minutes to set up'),
    step(second, `about $${Math.max(2, Math.round(capital / 25))} of gas`, '10 minutes, a week later'),
    step(
      'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    step(
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    step(
      "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes: never pay to claim, and never connect a wallet from a link in a direct message.",
      'no fee to check',
      '10 minutes',
    ),
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const trading = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  const byMarketCap = (a: SnapshotProtocol, b: SnapshotProtocol): number =>
    (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd;
  const ranked = [...trading].sort(byMarketCap).slice(0, LIVE_ROWS);
  return ranked.map((p) => ({
    slug: p.slug, // DefiLlama slug
    name: p.name, // display name
    category: p.category, // DefiLlama category, or null
    chains: p.chains, // chains the protocol runs on
    tvl_usd: p.tvl_usd, // total value locked, in dollars
    mcap_usd: p.mcap_usd, // market cap in dollars, or null
    change_7d: p.change_7d, // seven-day TVL change, or null
  }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank, // one-based position on the ranked board
    slug: row.slug, // DefiLlama slug
    name: row.name, // display name
    category: row.category, // DefiLlama category, or null
    chains: row.chains, // chains the protocol runs on
    tvl_usd: row.tvl_usd, // total value locked, in dollars
    change_7d: row.change_7d, // seven-day TVL change, or null
    mcap_usd: row.mcap_usd, // market cap, or null on every board row
    listed_at: row.listed_at, // first listing date, or null
    age_days: row.age_days, // whole days from first listing, or null
    implied_value_usd: row.implied_value_usd, // the row's implied value
    fit_base_usd: row.model.fit_base_usd, // power-law base in whole dollars
    growth_multiplier: row.model.growth_multiplier, // the growth multiplier applied
    maturity_multiplier: row.model.maturity_multiplier, // the maturity multiplier applied
    category_live_peers: row.model.category_live_peers, // live-token peers in the category
    category_median_mcap_usd: row.model.category_median_mcap_usd, // their median market cap, or null
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const fit = fitPowerLaw(snapshot.protocols);
  const backtest = backtestFit(snapshot.protocols, model, snapshot.as_of);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const fitted: PowerLawFit = { intercept: fit.intercept, slope: fit.slope, n: fit.n };
  const radar: RadarData = {
    as_of: snapshot.as_of, // the snapshot's date
    source: snapshot.source, // where the snapshot came from
    floor_usd: snapshot.floor_usd, // the watchlist floor in dollars
    model, // the model's constants
    model_version: MODEL_VERSION, // the model's version label
    fit: fitted, // the power-law fit the board was scored with
    backtest, // the leave-one-out backtest of that fit
    watchlist_size: snapshot.watchlist.length, // how many slugs the watchlist holds
    board_size: board.length, // how many rows the board holds
    early_size: early, // how many board rows sit below the floor
    live_size: live.length, // how many live-token protocols the Live view holds
    rows: board.map(radarRow), // the board in compact form
    live, // the live-token protocols, by market cap
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object at the top level');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date in YYYY-MM-DD form');
  }
  if (typeof doc.source !== 'string') throw new SnapshotError('snapshot.json has no source string');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no positive integer floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = doc.protocols.map((value, i) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    }
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.slug !== 'string' ||
      typeof entry.name !== 'string' ||
      typeof entry.tvl_usd !== 'number' ||
      !Number.isFinite(entry.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks a slug, a name or a finite TVL`);
    }
    const protocol: SnapshotProtocol = {
      slug: entry.slug, // DefiLlama slug
      name: entry.name, // display name
      category: typeof entry.category === 'string' ? entry.category : null, // DefiLlama category, or null
      chains: Array.isArray(entry.chains) ? entry.chains.filter((c): c is string => typeof c === 'string') : [], // chains, strings only
      tvl_usd: entry.tvl_usd, // total value locked, in dollars
      change_7d: typeof entry.change_7d === 'number' && Number.isFinite(entry.change_7d) ? entry.change_7d : null, // seven-day change, or null
      listed_at: typeof entry.listed_at === 'string' ? entry.listed_at : null, // first listing date, or null
      gecko_id: typeof entry.gecko_id === 'string' ? entry.gecko_id : null, // CoinGecko id, or null
      symbol: typeof entry.symbol === 'string' ? entry.symbol : null, // token symbol, or null
      mcap_usd: typeof entry.mcap_usd === 'number' && Number.isFinite(entry.mcap_usd) ? entry.mcap_usd : null, // market cap, or null
    };
    return protocol;
  });
  const snapshot: Snapshot = {
    as_of: doc.as_of, // the snapshot's date
    source: doc.source, // where the snapshot came from
    floor_usd: doc.floor_usd, // the watchlist floor in dollars
    protocols, // every protocol the snapshot carries
    watchlist: doc.watchlist as string[], // slugs on the watchlist
  };
  return snapshot;
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(', ');
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${shown}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const step of steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} has implied value ${row.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
