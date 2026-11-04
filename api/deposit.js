// Credit deposit system (agreed 2026-11-03, deposit-first).
// Users deposit credit in the miniapp BEFORE a Get Like: they call the
// existing, already-verified BoostPayment contract's payForLikes with
// a zero cast hash (the contract allows 0x0 for castHash), paying
// likeCount * 0.01 USDC, and this endpoint verifies that transaction
// on-chain and adds likeCount to the FID's credit ledger.
//  - GET  /api/deposit?fid=  -> { credit, freeRemaining } (read-only)
//  - POST /api/deposit { fid, txHash } -> claims the deposit once.
//    The same txHash can never be claimed twice. Cast is NOT checked
//    here (deposits carry no cast), unlike the old per-Get payment
//    flow. The old /api/pay endpoint is no longer deployed; this
//    endpoint replaces it for all new payments.
const { json, paymentsGet, paymentsSet, verifyPaymentTx, FREE_LIKES, FREE_FOLLOWERS } = require('./lib');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const fid = Number((req.query && req.query.fid) || '');
      if (!fid) return json(res, 400, { error: 'fid_required' });
      const ledger = await paymentsGet(fid);
      return json(res, 200, { credit: ledger.credit, freeRemaining: Math.max(0, FREE_LIKES - ledger.freeUsed), freeFollowRemaining: Math.max(0, FREE_FOLLOWERS - ledger.freeFollowUsed) });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const fid = Number(req.body && req.body.fid);
    const txHash = req.body && req.body.txHash;
    if (!fid || !txHash) return json(res, 400, { error: 'fid_tx_required' });
    const ledger = await paymentsGet(fid);
    if (ledger.txHashes.includes(txHash)) return json(res, 400, { error: 'tx_already_used', credit: ledger.credit });
    const v = await verifyPaymentTx(txHash, fid, null);
    ledger.credit += v.likeCount;
    ledger.txHashes.push(txHash);
    await paymentsSet(fid, ledger);
    return json(res, 200, {
      deposited: v.likeCount, amountUSDC: v.likeCount * 0.01, payer: v.payer,
      credit: ledger.credit, freeRemaining: Math.max(0, FREE_LIKES - ledger.freeUsed),
      freeFollowRemaining: Math.max(0, FREE_FOLLOWERS - ledger.freeFollowUsed),
    });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
};
