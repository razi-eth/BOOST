// GET /api/activate-status?fid=123&handle=<uuid> -> { status }
// Polls Neynar signer status; when approved, marks the pool entry approved.
const { neynar, json, poolSet } = require('./lib');

module.exports = async (req, res) => {
  try {
    const fid = Number(req.query.fid);
    const handle = req.query.handle;
    if (!fid || !handle) return json(res, 400, { error: 'fid_and_handle_required' });
    const out = await neynar('/farcaster/signer?signer_uuid=' + encodeURIComponent(handle), 'GET');
    const status = out.status || (out.signer && out.signer.status) || 'pending';
    if (status === 'approved') await poolSet(fid, { signerUuid: handle, status: 'approved', createdAt: Date.now() });
    return json(res, 200, { status });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
};
