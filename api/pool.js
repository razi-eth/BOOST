// GET /api/pool -> { count } — only the count, no signer details.
const { json, poolCount } = require('./lib');

module.exports = async (req, res) => {
  const count = await poolCount();
  return json(res, 200, { count, source: (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) ? 'redis' : (process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'memory') });
};
