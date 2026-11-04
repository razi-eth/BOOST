// POST /api/activate { fid } -> { approvalUrl, handle } or an error.
// Flow (Neynar managed signers, sponsored by Neynar):
//   1. POST /v2/farcaster/signer -> signer_uuid + public_key
//      (approval_url is null at this stage — never guess a URL, the old
//      https://app.neynar.com/signer/<uuid> guess 404'd).
//   2. Sign an EIP-712 SignedKeyRequest with the APP account (@0xbernard,
//      fid 256858) and register it via POST /v2/farcaster/signer/signed_key
//      with sponsor { sponsored_by_neynar: true }.
//   3. Neynar returns signer_approval_url, a farcaster://signed-key-request
//      deeplink. The frontend opens it via sdk.actions.openUrl, so Farcaster
//      shows its native in-app "Connect App" screen (0 warps, sponsored)
//      — never an external website.
// The app signing key is ONLY read from server env vars set by the app
// owner in the Vercel dashboard (FARCASTER_APP_PRIVATE_KEY, or
// FARCASTER_APP_MNEMONIC). It is never sent in chat, never in code, and
// never returned to the frontend. Without it, this endpoint returns
// approval_url_not_available instead of a fake URL.
const { neynar, json, poolGet, poolSet } = require('./lib');

const APP_FID = 256858;
const DOMAIN = {
  name: 'Farcaster SignedKeyRequestValidator',
  version: '1',
  chainId: 10,
  verifyingContract: '0x00000000FC700472606ED4fA22623Acf62c60553',
};
const TYPES = {
  SignedKeyRequest: [
    { name: 'requestFid', type: 'uint256' },
    { name: 'key', type: 'bytes' },
    { name: 'deadline', type: 'uint256' },
  ],
};

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const fid = Number(req.body && req.body.fid);
    if (!fid) return json(res, 400, { error: 'fid_required' });
    const existing = await poolGet(fid);
    if (existing && existing.status === 'approved') return json(res, 200, { already: true });
    const out = await neynar('/farcaster/signer', 'POST', {});
    const uuid = out.signer_uuid || out.signerUuid || (out.signer && out.signer.signer_uuid);
    const publicKey = out.public_key || (out.signer && out.signer.public_key);
    if (!uuid || !publicKey) return json(res, 502, { error: 'signer_create_failed' });
    await poolSet(fid, { signerUuid: uuid, status: 'pending', createdAt: Date.now() });
    // If Neynar already gave an approval URL, use it directly.
    const direct = out.signer_approval_url || out.approval_url || (out.signer && (out.signer.signer_approval_url || out.signer.approval_url));
    if (direct) return json(res, 200, { approvalUrl: direct, handle: uuid });
    // Otherwise register a signed key — requires the app signing key in env.
    const mnemonic = process.env.FARCASTER_APP_MNEMONIC || '';
    const priv = process.env.FARCASTER_APP_PRIVATE_KEY || '';
    if (!mnemonic && !priv) {
      return json(res, 200, { approvalUrl: null, handle: uuid, error: 'approval_url_not_available', needs: 'app_signing_env' });
    }
    // ethers v5 is CommonJS, so require() works in Vercel functions.
    // viem is ESM-only and broke the deployment.
    const { ethers } = require('ethers');
    const wallet = mnemonic ? ethers.Wallet.fromMnemonic(mnemonic) : new ethers.Wallet(priv.startsWith('0x') ? priv : '0x' + priv);
    const deadline = Math.floor(Date.now() / 1000) + 86400;
    const signature = await wallet._signTypedData(DOMAIN, TYPES, { requestFid: APP_FID, key: publicKey, deadline });
    const reg = await neynar('/farcaster/signer/signed_key', 'POST', {
      signer_uuid: uuid,
      app_fid: APP_FID,
      deadline,
      signature,
      sponsor: { sponsored_by_neynar: true },
    });
    const approvalUrl = reg.signer_approval_url || reg.approval_url || null;
    if (!approvalUrl) return json(res, 200, { approvalUrl: null, handle: uuid, error: 'approval_url_not_available' });
    return json(res, 200, { approvalUrl, handle: uuid });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
};
