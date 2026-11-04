// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BoostPayment
/// @notice Payment contract for the BOOST Farcaster miniapp.
/// @dev Rules agreed 2026-11-03 (preview, before deployment):
///  - Network: Base (chain 8453). Token: native USDC on Base.
///  - Price: 0.01 USDC per paid like. USDC has 6 decimals, so
///    0.01 USDC = 10_000 base units.
///  - The first 5 likes per Farcaster FID are free. That free quota is
///    tracked OFF-CHAIN by the BOOST backend (per FID, lifetime, only
///    consumed by likes that actually succeed). This contract only ever
///    handles the PAID likes: a caller pays likeCount * PRICE_PER_LIKE.
///  - Queued / already-liked / failed likes are never charged. The
///    backend quotes only likes that can actually be delivered, minus
///    the remaining free quota, before asking the user to pay.
///  - Paid likes that later fail on Neynar do NOT lose the user's
///    money: the backend records them as credit for the next Get.
///    That credit is also off-chain; this contract is deliberately
///    minimal and has no refund function.
///  - This contract never holds signers, never likes on anyone's
///    behalf, never asks for a private key or seed phrase.
///  - Only the owner can withdraw, and withdrawals go ONLY to the
///    owner address set at deployment. No other token movement exists.

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract BoostPayment {
    /// @notice Native USDC on Base mainnet.
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    /// @notice 0.01 USDC, in USDC base units (6 decimals).
    uint256 public constant PRICE_PER_LIKE = 10_000;

    address public immutable owner;

    /// @notice Total paid likes ever recorded per Farcaster FID.
    mapping(uint256 => uint256) public paidLikesByFid;
    /// @notice Total USDC base units ever paid per Farcaster FID.
    mapping(uint256 => uint256) public paidAmountByFid;

    event Paid(address indexed payer, uint256 indexed fid, uint256 likeCount, uint256 amount, bytes32 indexed castHash);
    event Withdrawn(address indexed owner, uint256 amount);

    error NotOwner();
    error ZeroLikes();
    error PaymentFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param _owner The wallet that receives all withdrawals.
    ///  Set once at deployment and never changeable afterwards.
    constructor(address _owner) {
        require(_owner != address(0), "owner is zero address");
        owner = _owner;
    }

    /// @notice Pay for `likeCount` paid likes for a Farcaster account.
    /// @dev Caller must first approve this contract to spend USDC
    ///  (approve USDC -> BoostPayment, amount = likeCount * 10000).
    ///  That is two user transactions in total: approve, then pay.
    ///  The backend must verify the on-chain transaction (Base chain,
    ///  USDC token, this contract as recipient, exact amount, and that
    ///  the transaction hash has never been used before) before it
    ///  runs the Get. The `fid` here is informational for the backend
    ///  ledger; FID ownership is enforced by the backend, not here.
    /// @param fid Farcaster FID the paid likes are for.
    /// @param likeCount Number of paid likes (must be > 0).
    /// @param castHash Hash of the cast the likes are for (0x0 allowed
    ///  if the caller does not want to bind the payment to a cast).
    function payForLikes(uint256 fid, uint256 likeCount, bytes32 castHash) external {
        if (likeCount == 0) revert ZeroLikes();
        uint256 amount = likeCount * PRICE_PER_LIKE;
        bool ok = IERC20(USDC).transferFrom(msg.sender, address(this), amount);
        if (!ok) revert PaymentFailed();
        paidLikesByFid[fid] += likeCount;
        paidAmountByFid[fid] += amount;
        emit Paid(msg.sender, fid, likeCount, amount, castHash);
    }

    /// @notice Withdraw the full USDC balance to the owner, and only
    ///  to the owner. No other address can ever receive funds.
    function withdraw() external onlyOwner {
        uint256 amount = IERC20(USDC).balanceOf(address(this));
        if (amount == 0) return;
        bool ok = IERC20(USDC).transfer(owner, amount);
        if (!ok) revert PaymentFailed();
        emit Withdrawn(owner, amount);
    }
}
