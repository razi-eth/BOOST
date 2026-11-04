// GET /api/cast?url=<full cast URL> or ?hash=0x...
// Resolves any author's cast so the user can boost it.
// URL lookup first (Neynar type=url handles warpcast.com, farcaster.xyz
// and short-hash share links that do NOT contain a full 0x hash), then
// hash lookup as a fallback. Returns author/text/likes for the target card.
const { neynar, json } = require('./lib');
module.exports = async (req, res) => {
  const url = req.query.url;
  const hash = req.query.hash;
  const attempts = [];
  if (url) attempts.push('/farcaster/cast?identifier=' + encodeURIComponent(url) + '&type=url');
  if (hash) attempts.push('/farcaster/cast?identifier=' + encodeURIComponent(hash) + '&type=hash');
  if (url) {
    const m = url.match(/0x[0-9a-fA-F]{10,64}/);
    if (m) attempts.push('/farcaster/cast?identifier=' + encodeURIComponent(m[0].toLowerCase()) + '&type=hash');
  }
  if (!attempts.length) return json(res, 400, { error: 'url_or_hash_required' });
  let lastErr = null;
  for (const path of attempts) {
    try {
      const c = await neynar(path, 'GET');
      const cast = c.cast || c;
      if (!cast || !cast.hash) continue;
      return json(res, 200, {
        hash: cast.hash,
        author: (cast.author && cast.author.username) || '',
        text: cast.text || '',
        likes: (cast.reactions && cast.reactions.likes_count) || 0,
      });
    } catch (e) { lastErr = e; }
  }
  return json(res, 500, { error: String((lastErr && lastErr.message) || lastErr || 'cast_not_found') });
};
