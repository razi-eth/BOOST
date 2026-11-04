// POST /api/pay { fid, txHash, castHash }
// Register a BoostPayment payForLikes transaction on Base as credit
// for this FID. Verifies on-chain: receipt success, recipient is the
// BoostPayment contract, Paid event fid/cast/amount match, and the
// txHash has never been used before. Credit is generic per FID after
// this point (failed paid likes also stay as credit after a Get).
const { json, paymentsGet, paymentsSet, verifyPaymentTx, FREE_LIKES } = require('./lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const fid = Number(req.body && req.body.fid);
    const txHash = req.body && req.body.txHash;
    const castHash = req.body && req.body.castHash;
    if (!fid || !txHash || !castHash) return json(res, 400, { error: 'fid_tx_cast_required' });
    const ledger = await paymentsGet(fid);
    if (ledger.txHashes.includes(txHash)) return json(res, 400, { error: 'tx_already_used', credit: ledger.credit });
    const v = await verifyPaymentTx(txHash, fid, castHash);
    ledger.credit += v.likeCount;
    ledger.txHashes.push(txHash);
    await paymentsSet(fid, ledger);
    return json(res, 200, {
      likeCount: v.likeCount, amountUSDC: v.likeCount * 0.01, payer: v.payer,
      credit: ledger.credit, freeRemaining: Math.max(0, FREE_LIKES - ledger.freeUsed),
    });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
};
