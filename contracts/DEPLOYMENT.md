# BoostPayment — Deployment (Base mainnet)

- **Contract:** `0xbf167378bf1caafd414cb8b8cf76b1897907d888`
- **Chain:** Base (8453)
- **Deploy tx:** `0x693da9451158d5631389abce1c66324fda7c5529c8fccaf33e2be6fda2080b5a`
- **Block:** 53426315, status success, gas used 583066, gas price 0.022754132 gwei, cost 0.000013267 ETH
- **Deployer:** via CreateX factory (deployer wallet redacted — not needed to use the contract)
- **Factory:** CreateX `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`, function `deployCreate2`, salt keccak256("BoostPayment-v1")
- **Owner:** the contract's `owner()` return value (readable on-chain; owner alone can call `withdraw()`)
- **USDC (Base):** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, PRICE_PER_LIKE = 10000 (0.01 USDC)
- **Withdraw mode:** manual only. Owner alone calls `withdraw()` to receive the full USDC balance. No auto-forward.
- **Verification done 2026-11-03:** receipt status 1, runtime code present at the contract address, `owner()` returns the owner address.

Note: contract addresses, deploy tx, and the owner address are public
on-chain data — anyone can read them from Base regardless of this repo.
What is intentionally not in this repo: any private key, mnemonic, API key,
or token, and any non-public wallet address.
