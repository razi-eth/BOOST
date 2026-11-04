// GET /api/casts?fid=123 -> { casts: [{hash,text,timestamp,likes,author,pfp_url}], user: {username, pfp_url} }
// User's own casts, newest first (Neynar returns newest first).
const { neynar, json } = require('./lib');

module.exports = async (req, res) => {
  try {
    const fid = Number(req.query.fid);
    if (!fid) return json(res, 400, { error: 'fid_required' });
    const out = await neynar('/farcaster/feed?feed_type=filter&filter_type=fids&fids=' + fid + '&limit=25', 'GET');
    const casts = (out.casts || []).map(c => ({
      hash: c.hash,
      text: c.text || '',
      timestamp: c.timestamp || '',
      likes: (c.reactions && c.reactions.likes_count) || 0,
      author: c.author && c.author.username,
      pfp_url: c.author && c.author.pfp_url,
    }));
    const firstAuthor = (out.casts && out.casts[0] && out.casts[0].author) || null;
    const user = firstAuthor ? { username: firstAuthor.username, pfp_url: firstAuthor.pfp_url } : null;
    return json(res, 200, { casts, user });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
};
