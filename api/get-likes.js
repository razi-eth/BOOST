// POST /api/get-likes { fid, castHash, amount }
// NO debt: uses approved pool signers (excluding the requester) to like
// the target cast, up to `amount`. Reports success/failed/queued honestly.
// If the pool is smaller than the amount, the rest is queued, not faked.
//
// Credit system (agreed 2026-11-03, deposit-first, replaces the old
// per-Get payment flow):
//  - 5 free likes lifetime per FID, consumed ONLY by likes that succeed.
//  - After free quota, each delivered like consumes 1 credit (1 credit
//    = 0.01 USDC, deposited in advance via /api/deposit against the
//    existing BoostPayment contract). This endpoint NEVER takes a
//    payment: if free + credit cannot cover the deliverable likes, it
//    returns 402 credit_required and sends NO likes, so the user can
//    deposit first and re-tap Get.
//  - Failed attempts consume neither free quota nor credit, so their
//    value stays as credit for the next Get.
const { neynar, json, computeQuote, paymentsGet, paymentsSet, verifyQuickAuth } = require('./lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const fid = Number(req.body && req.body.fid);
    const castHash = req.body && req.body.castHash;
    // No 100 cap (removed 2026-11-03, same silent-truncation bug as
    // get-followers: a Custom amount over 100 was clamped without telling
    // the user). Delivery is still limited by pool size, and credit is
    // only consumed on success.
    const amount = Math.max(1, Number(req.body && req.body.amount) || 0);
    if (!fid || !castHash || !amount) return json(res, 400, { error: 'fid_cast_amount_required' });
    const authed = await verifyQuickAuth(req.body && req.body.quickAuthToken, fid);
    if (!authed) return json(res, 401, { error: 'auth_required', detail: 'Quick Auth token missing or invalid for this FID. Open BOOST inside Farcaster.' });

    const ledger = await paymentsGet(fid);
    const q = await computeQuote(fid, castHash, amount, ledger);
    if (q.paidNeeded > 0) {
      const { deliverableSigners, ...quote } = q;
      return json(res, 402, { error: 'credit_required', creditNeeded: q.paidNeeded, ...quote });
    }

    let success = 0, failed = 0;
    let already = q.already;
    // Attempt the deliverable signers; if one turns out to have
    // already liked at attempt time, silently pull a spare signer
    // who has not liked yet instead of surfacing "already liked".
    const attempts = [...q.deliverableSigners];
    const spares = [...(q.spareSigners || [])];
    while (attempts.length) {
      const s = attempts.shift();
      try {
        await neynar('/farcaster/reaction', 'POST', {
          signer_uuid: s.signerUuid, reaction_type: 'like', target: castHash,
        });
        success++;
      } catch (e) {
        if (/already|duplicate/i.test(String(e && e.message || e))) {
          already++;
          if (spares.length) attempts.push(spares.shift());
        } else failed++;
      }
    }
    const queued = q.queued;

    // Accounting: only successes consume free quota first, then credit.
    // Failed attempts consume nothing, so their paid value stays as credit.
    const freeConsumed = Math.min(success, Math.max(0, 5 - ledger.freeUsed));
    ledger.freeUsed += freeConsumed;
    const afterFree = success - freeConsumed;
    const creditConsumed = Math.min(afterFree, ledger.credit);
    ledger.credit -= creditConsumed;
    await paymentsSet(fid, ledger);

    // USER ORDER 2026-11-03 ~04:07 WIB: the pool shortfall (queued)
    // is shown in the Failed info, so the visible status reads
    // Requested = Succeeded + Failed. E.g. requesting 20 with only
    // 5 deliverable likes shows Succeeded: 5, Failed: 15. `already`
    // stays a separate skipped count, and `queued` is still returned
    // in the API response for diagnostics, but the Get Like status
    // card does not display it.
    return json(res, 200, {
      requested: amount, success, failed: failed + queued, already, queued, pool: q.pool,
      freeRemaining: Math.max(0, 5 - ledger.freeUsed), credit: ledger.credit,
    });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
};
