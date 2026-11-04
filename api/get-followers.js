// POST /api/get-followers { fid, amount }
// Same pool model as get-likes, but the pool signers follow the target FID.
// Credit system (agreed 2026-11-03, same as Get Like, except free quota):
//  - NO free followers (removed 2026-11-03 ~13:28 WIB): every follower
//    consumes 1 credit from the first one. The 5 free likes are untouched.
//  - After free quota, each delivered follower consumes 1 shared credit
//    (1 credit = 0.01 USDC, deposited in advance via /api/deposit).
//    This endpoint NEVER takes a payment: if free + credit cannot
//    cover the REQUESTED amount, it returns 402 credit_required and
//    sends NO follows, so the user can deposit first and re-tap Get.
//  - Failed attempts and pool shortfall consume nothing; the shortfall
//    is shown in Failed (like Get Like), not Queued.
const { neynar, json, poolApproved, paymentsGet, paymentsSet, FREE_FOLLOWERS, verifyQuickAuth } = require('./lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const fid = Number(req.body && req.body.fid);
    // No 100 cap (removed 2026-11-03): the frontend Custom amount allows
    // e.g. 125, and silently clamping to 100 misreported creditNeeded
    // (125 requested showed as 100 needed). Delivery is still limited
    // by pool size, and credit is only consumed on success.
    const amount = Math.max(1, Number(req.body && req.body.amount) || 0);
    if (!fid || !amount) return json(res, 400, { error: 'fid_amount_required' });
    const authed = await verifyQuickAuth(req.body && req.body.quickAuthToken, fid);
    if (!authed) return json(res, 401, { error: 'auth_required', detail: 'Quick Auth token missing or invalid for this FID. Open BOOST inside Warpcast.' });
    const approved = await poolApproved();
    const signers = approved.filter(s => s.fid !== fid).map(s => s.signerUuid);
    const deliverable = Math.min(amount, signers.length);
    const queued = Math.max(0, amount - deliverable);
    const ledger = await paymentsGet(fid);
    const freeFollowRemaining = Math.max(0, FREE_FOLLOWERS - ledger.freeFollowUsed);
    const freeApplied = Math.min(amount, freeFollowRemaining);
    const afterFree = amount - freeApplied;
    const creditApplied = Math.min(afterFree, ledger.credit);
    const paidNeeded = afterFree - creditApplied;
    if (paidNeeded > 0) {
      return json(res, 402, { error: 'credit_required', creditNeeded: paidNeeded,
        requested: amount, deliverable, queued, pool: signers.length,
        freeFollowRemaining, credit: ledger.credit, paidNeeded });
    }
    let success = 0, failed = 0;
    for (const uuid of signers.slice(0, amount)) {
      try {
        await neynar('/farcaster/user/follow', 'POST', { signer_uuid: uuid, target_fids: [fid] });
        success++;
      } catch { failed++; }
    }
    const freeConsumed = Math.min(success, freeFollowRemaining);
    ledger.freeFollowUsed += freeConsumed;
    const creditConsumed = Math.min(success - freeConsumed, ledger.credit);
    ledger.credit -= creditConsumed;
    await paymentsSet(fid, ledger);
    return json(res, 200, { requested: amount, success, failed: failed + queued, queued, pool: signers.length,
      freeFollowRemaining: Math.max(0, FREE_FOLLOWERS - ledger.freeFollowUsed), credit: ledger.credit });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
};
