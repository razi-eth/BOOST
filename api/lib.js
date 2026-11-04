// Shared backend helpers for the Get Like / Get Followers miniapp (v1.2).
// Pool storage is now PERSISTENT via Upstash Redis (keys boost:pool and
// boost:payments) when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are
// set (or the Marketplace equivalents KV_REST_API_URL + KV_REST_API_TOKEN),
// so the pool survives redeploys and is shared across serverless
// instances. This replaced Vercel Blob on 2026-11-03 after the Blob store
// get-like-follow-pool hit its 2,000/month Advanced Operations quota
// (2,003 used, store suspended). If Redis holds no data yet and Blob is
// readable again, the old Blob JSON is imported into Redis once on read.
// Without Redis it falls back to Blob, then to in-memory (demo only).
// Signer UUIDs are NEVER sent to the frontend except as an opaque
// session handle kept in localStorage; the UI never displays signer data.

const NEYNAR = 'https://api.neynar.com/v2';
const POOL_FILE = 'pool.json';

function apiKey() {
  return process.env.NEYNAR_API_KEY || '';
}

async function neynar(path, method = 'GET', body) {
  const key = apiKey();
  if (!key) throw new Error('NEYNAR_API_KEY belum diset di server');
  const res = await fetch(NEYNAR + path, {
    method,
    headers: { 'api_key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error((json && (json.message || json.error)) || ('Neynar ' + res.status));
  return json;
}

function json(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(obj));
}

// --- Persistent pool ---
if (!globalThis.__poolMem) globalThis.__poolMem = new Map();
const mem = globalThis.__poolMem;

async function blob() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try { return require('@vercel/blob'); } catch { return null; }
}

// --- Upstash Redis (REST, no extra dependency) ---
function redisCfg() {
  // Primary names (manual Upstash setup), falling back to the names the
  // Vercel Marketplace Upstash integration actually sets (KV_REST_API_*).
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

async function redisGet(key) {
  const cfg = redisCfg();
  if (!cfg) return null;
  try {
    const r = await fetch(cfg.url + '/get/' + encodeURIComponent(key), {
      headers: { Authorization: 'Bearer ' + cfg.token },
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.result == null) return null;
    return typeof j.result === 'string' ? JSON.parse(j.result) : j.result;
  } catch { return null; }
}

async function redisSet(key, data) {
  const cfg = redisCfg();
  if (!cfg) return false;
  try {
    const r = await fetch(cfg.url + '/set/' + encodeURIComponent(key) + '/' + encodeURIComponent(JSON.stringify(data)), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token },
    });
    return r.ok;
  } catch { return false; }
}

async function poolRead() {
  const fromRedis = await redisGet('boost:pool');
  if (fromRedis && Object.keys(fromRedis).length) return fromRedis;
  // First run after the Blob->Redis migration: import the old Blob
  // data once, if it is readable again. Redis stays authoritative
  // afterwards (an empty Redis + empty Blob = a genuinely empty pool).
  const b = await blob();
  if (!b) {
    if (fromRedis) return fromRedis;
    return Object.fromEntries(mem.entries());
  }
  try {
    const { blobs } = await b.list({ prefix: POOL_FILE, limit: 1 });
    if (!blobs.length) return fromRedis || {};
    const r = await fetch(blobs[0].url);
    if (!r.ok) return fromRedis || {};
    const data = await r.json();
    if (data && Object.keys(data).length) await redisSet('boost:pool', data);
    return data;
  } catch { return fromRedis || Object.fromEntries(mem.entries()); }
}

async function poolWrite(data) {
  for (const [k, v] of Object.entries(data)) mem.set(Number(k), v);
  if (redisCfg()) {
    if (await redisSet('boost:pool', data)) return 'redis';
  }
  const b = await blob();
  if (!b) return 'memory';
  try {
    await b.put(POOL_FILE, JSON.stringify(data), { access: 'public', addRandomSuffix: false, allowOverwrite: true });
    return 'blob';
  } catch (e) { globalThis.__poolWriteError = String(e && e.message || e); return 'memory:' + globalThis.__poolWriteError; }
}

async function poolGet(fid) {
  const data = await poolRead();
  return data[fid] || null;
}

async function poolSet(fid, entry) {
  const data = await poolRead();
  data[fid] = entry;
  return poolWrite(data);
}

async function poolApproved() {
  const data = await poolRead();
  const out = [];
  for (const [fid, v] of Object.entries(data)) {
    if (v && v.status === 'approved') out.push({ fid: Number(fid), signerUuid: v.signerUuid });
  }
  return out;
}

async function poolCount() {
  return (await poolApproved()).length;
}

// --- BOOST paid likes (Base, USDC) ---
// Agreed rules 2026-11-03: 5 free likes lifetime per FID (consumed only
// by likes that actually succeed); beyond that 0.01 USDC per paid like,
// charged only for likes that can actually be delivered (never Queued,
// Already liked, or Failed). Paid likes that fail on Neynar are NOT
// lost: their credit stays in the ledger for the next Get.
// Contract deployed 2026-11-03 on Base (see contracts/DEPLOYMENT.md).
const BOOST_CONTRACT = '0xbf167378bf1caafd414cb8b8cf76b1897907d888';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PRICE_PER_LIKE = 10000; // 0.01 USDC, 6 decimals
const FREE_LIKES = 5;
const FREE_FOLLOWERS = 0; // REMOVED 2026-11-03 ~13:28 WIB on user order: Get Followers has NO free quota, credit only from the first follower
const BASE_RPC = 'https://mainnet.base.org';
const PAID_EVENT = '0x26fc954e729106a613590c07c61c274a9b9185850c09d5546533c3295d1c34c6';
const PAYMENTS_FILE = 'payments.json';

async function paymentsRead() {
  const fromRedis = await redisGet('boost:payments');
  if (fromRedis && Object.keys(fromRedis).length) return fromRedis;
  const b = await blob();
  if (!b) {
    if (fromRedis) return fromRedis;
    if (!globalThis.__paymentsMem) globalThis.__paymentsMem = {};
    return globalThis.__paymentsMem;
  }
  try {
    const { blobs } = await b.list({ prefix: PAYMENTS_FILE, limit: 1 });
    if (!blobs.length) return fromRedis || {};
    const r = await fetch(blobs[0].url);
    if (!r.ok) return fromRedis || {};
    const data = await r.json();
    if (data && Object.keys(data).length) await redisSet('boost:payments', data);
    return data;
  } catch { return fromRedis || {}; }
}

async function paymentsWrite(data) {
  if (redisCfg()) {
    if (await redisSet('boost:payments', data)) return 'redis';
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    globalThis.__paymentsMem = data;
    return 'memory';
  }
  const b = await blob();
  if (!b) { globalThis.__paymentsMem = data; return 'memory'; }
  try {
    await b.put(PAYMENTS_FILE, JSON.stringify(data), { access: 'public', addRandomSuffix: false, allowOverwrite: true });
    return 'blob';
  } catch (e) { globalThis.__paymentsMem = data; return 'memory:' + String(e && e.message || e); }
}

async function paymentsGet(fid) {
  const data = await paymentsRead();
  const l = data[fid] || {};
  // FREE LIKES -> FREE CREDIT CONVERSION (agreed 2026-11-03 ~13:36 WIB):
  // the old 5 lifetime free likes are gone. Any unused free likes are
  // converted 1-for-1 into credit here, on read, and the conversion is
  // idempotent: once freeUsed is 5, the legacy remainder is 0, so a
  // converted ledger is never converted again. A brand-new FID (no
  // ledger yet, freeUsed 0) therefore starts at Credit: 5, visible in
  // the header immediately. The converted values are persisted on the
  // next paymentsSet (any Get or Deposit); reads alone already show
  // the converted credit, so no separate migration run is needed.
  const legacyFree = Math.max(0, FREE_LIKES - (l.freeUsed || 0));
  return { freeUsed: FREE_LIKES, freeFollowUsed: l.freeFollowUsed || 0, credit: (l.credit || 0) + legacyFree, txHashes: l.txHashes || [] };
}

async function paymentsSet(fid, ledger) {
  const data = await paymentsRead();
  data[fid] = ledger;
  return paymentsWrite(data);
}

// Who already liked a cast, among pool signers. Same Neynar call as
// get-likes: hash + types=likes (identifier/type/reaction_type is
// rejected with 400 'hash is required').
async function alreadyFidsForCast(castHash, maxSigners) {
  const already = new Set();
  try {
    let cursor = null;
    for (let page = 0; page < 5; page++) {
      const q = '/farcaster/reactions/cast?hash=' + encodeURIComponent(castHash) + '&types=likes&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const r = await neynar(q);
      const list = (r && r.reactions) || [];
      for (const x of list) {
        const f = x && x.user && x.user.fid;
        if (f) already.add(Number(f));
      }
      cursor = (r && r.next && r.next.cursor) || (r && r.cursor) || null;
      if (!cursor || already.size >= maxSigners) break;
      if (!list.length) break;
    }
  } catch { /* fall back to attempting; duplicate errors still count as already */ }
  return already;
}

// Quote a Get Like WITHOUT changing any state. Skips pool signers
// who already liked and keeps scanning the pool until `amount`
// deliverable signers are found; any remainder after the pool is
// exhausted is queued, never faked.
// ledgerOverride: when get-likes has just applied a payment in-memory
// in the same request, use that ledger instead of re-reading Blob —
// re-reading immediately after a Blob write can return the stale,
// pre-payment version (the race that made a paid Get report
// 'payment_required' right after a successful payment, 2026-11-03).
async function computeQuote(fid, castHash, amount, ledgerOverride) {
  const approved = await poolApproved();
  const signers = approved.filter(s => s.fid !== fid);
  // USER ORDER 2026-11-03: likes must NOT come in pool join order
  // (@0xbernard, @notz, @rz1, @baserooms, ... first every time).
  // Shuffle the candidate signers with Fisher-Yates on every request,
  // so each Boost Cast picks a random subset of the pool instead of
  // always starting from the earliest-joined members.
  for (let i = signers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [signers[i], signers[j]] = [signers[j], signers[i]];
  }
  const alreadySet = await alreadyFidsForCast(castHash, signers.length);
  // FIX 2026-11-03: do NOT stop at the first `amount` signers. The old
  // loop counted attempts (already + deliverable) against `amount`, so
  // a Get of 3 whose first 3 pool members had already liked returned
  // deliverable 0 / already 3, even though later pool members had not
  // liked yet. Now already-liked signers are SKIPPED and scanning
  // continues through the whole pool until `amount` deliverable
  // signers are found, or the pool runs out. `already` is the number
  // of already-liked signers skipped while filling the request;
  // `queued` is now the true shortfall (requested - deliverable),
  // i.e. likes that cannot be delivered because no pool member is
  // left who has not liked yet.
  let deliverable = 0, already = 0;
  const deliverableSigners = [];
  for (const s of signers) {
    if (deliverable >= amount) break;
    if (alreadySet.has(s.fid)) { already++; continue; }
    deliverable++;
    deliverableSigners.push(s);
  }
  const queued = Math.max(0, amount - deliverable);
  // Spare candidates for get-likes: non-already-liked pool members
  // beyond the first `amount`, in the same shuffled order. If a
  // deliverable signer turns out to have already liked at attempt
  // time (race with the alreadySet check), get-likes can pull a spare
  // instead of reporting that signer as "already liked".
  const spareSigners = signers.filter(s => !alreadySet.has(s.fid) && !deliverableSigners.includes(s));
  const ledger = ledgerOverride || await paymentsGet(fid);
  const freeRemaining = Math.max(0, FREE_LIKES - ledger.freeUsed);
  // USER ORDER 2026-11-03 ~04:02 WIB: credit need follows the REQUESTED
  // amount, not the deliverable amount. E.g. choosing 20 likes with
  // 0 free and 0 credit shows "you need 20 more credit", even if the
  // pool can only deliver 5 right now; same rule for every amount.
  // This supersedes the earlier deliverable-based paidNeeded for the
  // deposit prompt. Actual consumption is unchanged: only likes that
  // succeed consume free quota / credit (see get-likes.js), so any
  // credit deposited beyond the deliverable amount is NOT lost — it
  // stays in the FID's ledger for later Gets.
  const freeApplied = Math.min(amount, freeRemaining);
  const afterFree = amount - freeApplied;
  const creditApplied = Math.min(afterFree, ledger.credit);
  const paidNeeded = afterFree - creditApplied;
  return {
    requested: amount, deliverable, already, queued, pool: signers.length,
    freeRemaining, freeApplied, credit: ledger.credit, creditApplied,
    paidNeeded, totalUSDC: paidNeeded * 0.01, totalUnits: paidNeeded * PRICE_PER_LIKE,
    deliverableSigners, spareSigners,
  };
}

// Verify a BoostPayment payForLikes transaction on Base.
// Returns { payer, fid, likeCount, amount, castHash } or throws.
async function verifyPaymentTx(txHash, fid, castHash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || '')) throw new Error('invalid_tx_hash');
  const res = await fetch(BASE_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }),
  });
  const j = await res.json();
  const r = j && j.result;
  if (!r) throw new Error('tx_not_found');
  if (r.status !== '0x1') throw new Error('tx_failed');
  if ((r.to || '').toLowerCase() !== BOOST_CONTRACT) throw new Error('tx_not_to_boost_contract');
  const log = (r.logs || []).find(l =>
    (l.address || '').toLowerCase() === BOOST_CONTRACT &&
    l.topics && l.topics[0] === PAID_EVENT);
  if (!log) throw new Error('paid_event_not_found');
  const payer = '0x' + log.topics[1].slice(-40);
  const logFid = parseInt(log.topics[2], 16);
  const logCastHash = log.topics[3];
  if (logFid !== fid) throw new Error('paid_fid_mismatch');
  // Farcaster cast hashes are 20 bytes; the contract stores them as
  // bytes32, left-padded with zeros. Normalise the same way before
  // comparing, or a 20-byte submitted hash would never match.
  if (castHash) {
    const submitted = String(castHash).toLowerCase().replace(/^0x/, '');
    const padded = '0x' + submitted.padStart(64, '0');
    if (logCastHash.toLowerCase() !== padded) throw new Error('paid_cast_mismatch');
  }
  const data = (log.data || '').replace(/^0x/, '');
  const likeCount = parseInt(data.slice(0, 64), 16);
  const amount = parseInt(data.slice(64, 128), 16);
  if (!likeCount || amount !== likeCount * PRICE_PER_LIKE) throw new Error('paid_amount_mismatch');
  return { payer, fid: logFid, likeCount, amount, castHash: logCastHash };
}

function b64urlDecode(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function es256Der(sig) {
  const r = Buffer.from(sig.subarray(0, 32));
  const s = Buffer.from(sig.subarray(32, 64));
  function encInt(x) {
    let v = x;
    while (v.length > 1 && v[0] === 0 && !(v[1] & 0x80)) v = v.subarray(1);
    if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]);
    return Buffer.concat([Buffer.from([0x02, v.length]), v]);
  }
  const ri = encInt(r);
  const si = encInt(s);
  const body = Buffer.concat([ri, si]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}
async function verifyQuickAuth(token, fid) {
  try {
    if (!token || !fid) return false;
    const parts = String(token).split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
    const payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
    if (!['ES256', 'RS256', 'EdDSA'].includes(header.alg) || !header.kid) return false;
    if (Number(payload.sub) !== Number(fid)) return false;
    const domain = 'get-like-follow.vercel.app';
    const aud = payload.aud;
    if (!(aud === domain || (Array.isArray(aud) && aud.includes(domain)))) return false;
    if (payload.exp && Number(payload.exp) * 1000 <= Date.now()) return false;
    if (!payload.iss || !String(payload.iss).startsWith('https://')) return false;
    const iss = String(payload.iss).replace(/\/$/, '');
    const candidates = [iss + '/.well-known/jwks.json', iss + '/miniapp/jwks.json', 'https://auth.farcaster.xyz/.well-known/jwks.json'];
    const crypto = require('crypto');
    let keyObj = null;
    for (const url of candidates) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const j = await r.json();
        const k = (j.keys || []).find(x => x.kid === header.kid);
        if (!k) continue;
        keyObj = crypto.createPublicKey({ key: k, format: 'jwk' });
        break;
      } catch {}
    }
    if (!keyObj) return false;
    const input = Buffer.from(parts[0] + '.' + parts[1]);
    const sig = b64urlDecode(parts[2]);
    if (header.alg === 'ES256') return crypto.verify('sha256', input, keyObj, es256Der(sig));
    if (header.alg === 'RS256') return crypto.verify('sha256', input, keyObj, sig);
    return crypto.verify(null, input, keyObj, sig);
  } catch {
    return false;
  }
}

module.exports = { neynar, json, poolGet, poolSet, poolApproved, poolCount, poolWrite, poolRead,
  BOOST_CONTRACT, USDC_BASE, PRICE_PER_LIKE, FREE_LIKES, FREE_FOLLOWERS,
  paymentsGet, paymentsSet, alreadyFidsForCast, computeQuote, verifyPaymentTx, verifyQuickAuth };
