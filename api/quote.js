// POST /api/quote { fid, castHash, amount }
// Read-only quote for a Get Like: how many likes can actually be
// delivered, how many are free, how much credit applies, and how many
// paid likes (0.01 USDC each on Base) are still needed. No state change,
// no payment, no likes sent.
const { json, computeQuote } = require('./lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const fid = Number(req.body && req.body.fid);
    const castHash = req.body && req.body.castHash;
    // No 100 cap (removed 2026-11-03, same silent-truncation bug as
    // get-likes/get-followers).
    const amount = Math.max(1, Number(req.body && req.body.amount) || 0);
    if (!fid || !castHash || !amount) return json(res, 400, { error: 'fid_cast_amount_required' });
    const q = await computeQuote(fid, castHash, amount);
    const { deliverableSigners, spareSigners, ...out } = q;
    return json(res, 200, out);
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
};
