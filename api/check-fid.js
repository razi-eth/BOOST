// GET /api/check-fid?fid=123 -> { status }
// Checks the pool entry for THIS fid server-side (no handle needed from
// the browser), so an account switch or lost localStorage does not lose
// an approval that Neynar already recorded. Returns status only, never UUIDs.
//
// IMPORTANT (fix 2026-11-03): an entry stored as 'approved' is NOT
// trusted blindly. @0xbernard's primary signer was approved on
// 2026-11-02 but later REVOKED on Neynar, and the old short-circuit
// ('approved' -> return approved without checking Neynar) made the
// app keep showing 'Signer active' and made /api/activate return
// 'already: true', so re-activation was impossible. Now every entry
// with a signerUuid is re-validated live against Neynar: if Neynar
// says revoked, the entry is marked revoked so /api/activate will
// create a fresh signer on the next Sign In. Only a Neynar lookup
// failure falls back to the stored status, so a transient Neynar
// outage does not lock a good user out.
const { neynar, json, poolGet, poolSet } = require('./lib');
module.exports = async (req, res) => {
  const fid = Number(req.query.fid);
  if (!fid) return json(res, 400, { error: 'fid_required' });
  const entry = await poolGet(fid);
  if (!entry) return json(res, 200, { status: 'none' });
  if (!entry.signerUuid) return json(res, 200, { status: entry.status || 'pending' });
  try {
    const s = await neynar('/farcaster/signer?signer_uuid=' + encodeURIComponent(entry.signerUuid), 'GET');
    const status = s.status || 'pending';
    if (status === 'approved' && entry.status !== 'approved') await poolSet(fid, { signerUuid: entry.signerUuid, status: 'approved', createdAt: entry.createdAt || Date.now() });
    if (status === 'revoked') await poolSet(fid, { signerUuid: entry.signerUuid, status: 'revoked', createdAt: entry.createdAt || Date.now() });
    return json(res, 200, { status });
  } catch (e) {
    return json(res, 200, { status: entry.status || 'pending' });
  }
};
