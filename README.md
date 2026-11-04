# BOOST — Get Like & Follow

BOOST is a Farcaster miniapp for reciprocal likes and follows. Open it inside
Farcaster, activate once (the approval opens in Farcaster), then use Get Like
or Get Followers on your own casts.

Live app: https://get-like-follow.vercel.app

## How it works

- **Reciprocal pool, no debt.** Approved signers join the pool and are used
  to like/follow other pool members. There is no debt ledger and no replies
  are tracked. If the pool is smaller than the requested amount, the
  remainder is reported as queued/failed, not claimed as successful.
- **Credit system.** Get Like and Get Followers share one credit ledger:
  1 credit per like or follower, 0.01 USDC each. Only successful
  likes/follows consume credit; failed or shortfall attempts consume nothing.
- **Quick Auth gate.** `get-likes` and `get-followers` require a fresh
  Farcaster Quick Auth token for the requesting FID. Unauthenticated calls
  return 401 and send nothing.
- **Deposit.** Users deposit USDC on Base to the BoostPayment contract to
  buy credit. The owner can withdraw the contract balance manually.
- **Share.** Sharing opens Farcaster's composer with a caption and the BOOST
  card; nothing is posted until the user taps Cast in Farcaster.

## Stack

- Frontend: `index.html` (single page, Farcaster Mini App SDK)
- Backend: Vercel serverless functions in `api/` (Node.js, no framework)
- Data: Upstash Redis for the pool and credit ledger
- Payments: `contracts/BoostPayment.sol` on Base (chain 8453), USDC
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, contract
  `0xbf167378bf1caafd414cb8b8cf76b1897907d888`
- Farcaster data: Neynar API

## Backend endpoints

- `api/activate.js` — create a Neynar managed signer, return the approval URL.
- `api/activate-status.js` — check approval status, mark the pool approved.
- `api/casts.js` — the user's own casts, newest first.
- `api/cast.js` — resolve a pasted cast URL to a target cast.
- `api/get-likes.js` — pool likes the target cast (Quick Auth gated).
- `api/get-followers.js` — pool follows the target FID (Quick Auth gated).
- `api/pool.js` / `api/pool-status.js` — pool count/status only, no signer details.
- `api/quote.js`, `api/pay.js`, `api/deposit.js` — credit quotes, payments, deposits.
- `api/check-fid.js` — re-validate a pool entry's signer status live.
- `api/lib.js` — shared Neynar, Redis, payment, and Quick Auth helpers.

## Environment variables (names only, set in Vercel)

- `NEYNAR_API_KEY`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
  (or the Vercel Marketplace equivalents `KV_REST_API_URL`, `KV_REST_API_TOKEN`)
- `FARCASTER_APP_PRIVATE_KEY` or `FARCASTER_APP_MNEMONIC`
  (app signing key, never committed to this repo)

## License

MIT — see `LICENSE`.
