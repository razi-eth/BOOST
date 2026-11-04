// Diagnostic: pool entries by status, FIDs only — never signer UUIDs.
const { json, poolRead } = require('./lib');
module.exports = async (req, res) => {
  const data = await poolRead();
  const entries = Object.entries(data).map(([fid, v]) => ({ fid: Number(fid), status: v && v.status, createdAt: v && v.createdAt }));
  return json(res, 200, {
    total: entries.length,
    approved: entries.filter(e => e.status === 'approved').length,
    pending: entries.filter(e => e.status !== 'approved').length,
    entries,
  });
};
