# ⭐ StarVote — Stellar Live Poll (Orange Belt dApp)

A fully on-chain live polling dApp built with **Soroban** smart contracts on **Stellar Testnet** and **Next.js 16**. Every vote is a signed blockchain transaction with real-time result updates.

---

## 🔗 Live Demo
> https://orange-belt-deploy-ra74.vercel.app

## 📹 Demo Video
> https://youtu.be/mpj_mVS9BTk
## ✅ Tests Passing (7/7)
![Tests Passing](./test-results.png)

---

## 📋 Table of Contents
1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Features — Level 3](#features--level-3)
4. [Setup Instructions](#setup-instructions)
5. [Smart Contract](#smart-contract)
6. [Deployment](#deployment)
7. [Running Tests](#running-tests)
8. [Architecture](#architecture)

---

## Project Overview

StarVote lets Stellar wallet holders vote on a community question. Results update in real time with animated progress bars. Each wallet address can only vote once — enforced on-chain by the Soroban smart contract.

**Poll question:** *What should the Stellar community prioritize in 2026?*

| Feature | Status |
|---|---|
| On-chain voting via Soroban | ✅ |
| Freighter wallet connection | ✅ |
| 4-step transaction progress tracker | ✅ |
| localStorage caching (30s TTL) | ✅ |
| 7 contract tests passing | ✅ |
| Complete README | ✅ |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contract | Rust + Soroban SDK (no_std) |
| Network | Stellar Testnet |
| Frontend | Next.js 16, TypeScript, Tailwind CSS v4 |
| Wallet | Freighter via `@stellar/freighter-api` |
| Stellar SDK | `@stellar/stellar-sdk` |
| Deployment | Vercel |

---

## Features — Level 3

### ✅ Loading States & Progress Indicators
- Spinner on Connect button while Freighter popup opens
- **4-step transaction tracker:** Signing → Broadcasting → Confirming → Complete
- Each step lights up in real time as the transaction progresses
- Skeleton loader while poll data loads from chain

### ✅ Basic Caching — localStorage
- Poll results cached with **30-second TTL**
- Instant render on revisit — no blank screen
- Stale-while-revalidate: old data shown while background refresh runs
- Cache cleared automatically after a successful vote

### ✅ Minimum 3 Tests Passing
7 tests passing — see [Running Tests](#running-tests)

### ✅ Complete README
This document covers setup, deployment, contract explanation, and architecture.

---

## Setup Instructions

### Prerequisites
- Node.js ≥ 20
- Rust: `rustup target add wasm32-unknown-unknown`
- Stellar CLI: `cargo install --locked stellar-cli --features opt`
- [Freighter](https://freighter.app) browser extension set to **Testnet**

### Clone & Run

```bash
git clone https://github.com/Nandini-Jadhav1/orange-belt-deploy.git
cd orange-belt-deploy/contracts/hello-world/live-poll-ui
npm install
npm run dev
# → http://localhost:3000
```

### Environment Variables

Create `live-poll-ui/.env.local`:
```env
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
```
Leave `NEXT_PUBLIC_CONTRACT_ID` empty to run in mock mode locally.

---

## Smart Contract

**File:** `contracts/hello-world/src/lib.rs`

### Functions

| Function | Parameters | Returns | Description |
|---|---|---|---|
| `initialize` | question, options | `Result<(), PollError>` | Sets up the poll once |
| `vote` | option: u32, voter: Address | `Result<(), PollError>` | Casts one authenticated vote |
| `get_results` | — | `Vec<u32>` | Vote counts per option |
| `get_options` | — | `Vec<String>` | Option labels |
| `get_question` | — | `String` | Poll question |
| `has_voted` | voter: Address | `bool` | Whether address already voted |

### Error Codes

| Code | Name | When triggered |
|---|---|---|
| 1 | `NotInitialized` | vote() called before initialize() |
| 2 | `AlreadyVoted` | Same address votes twice |
| 3 | `InvalidOption` | Option index out of range |
| 4 | `AlreadyInit` | initialize() called twice |

### Storage Layout

| Key | Type | Description |
|---|---|---|
| `"initialized"` | bool | Guard flag |
| `"question"` | String | Poll question |
| `"options"` | Vec\<String\> | Option labels |
| `"results"` | Vec\<u32\> | Vote tallies |
| `("voted", Address)` | bool | Per-voter flag |

---

## Deployment

### 1. Build WASM
```bash
cd contracts/hello-world
stellar contract build
```

### 2. Fund deployer
```bash
stellar keys generate deployer --network testnet
stellar keys fund deployer --network testnet
```

### 3. Deploy contract
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/hello_world.wasm \
  --source deployer \
  --network testnet
# Outputs: CONTRACT_ID starting with C...
```

### 4. Initialize poll
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- initialize \
  --question "What should the Stellar community prioritize in 2026?" \
  --options '["DeFi & DEX improvements","Cross-chain bridges","Mobile wallet UX","Developer tooling"]'
```

### 5. Deploy frontend to Vercel
1. Push repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import repo
3. Set **Root Directory** to `contracts/hello-world/live-poll-ui`
4. Add env var: `NEXT_PUBLIC_CONTRACT_ID=<your contract id>`
5. Click Deploy → copy the live URL

---

## Running Tests

```bash
cd contracts/hello-world
cargo test
```

### Test Suite (7/7 passing)

| # | Test | What it verifies |
|---|---|---|
| 1 | `test_vote_increments_correct_option` | Vote lands on correct counter |
| 2 | `test_double_vote_rejected` | AlreadyVoted error fires |
| 3 | `test_invalid_option_rejected` | InvalidOption error fires |
| 4 | `test_has_voted_tracking` | has_voted() tracks false → true |
| 5 | `test_poll_metadata_stored_correctly` | Question & options round-trip |
| 6 | `test_double_init_rejected` | AlreadyInit error fires |
| 7 | `test_votes_accumulate_correctly` | Multiple voters accumulate correctly |

**Expected output:**
```
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

---

## Architecture

### localStorage Caching (Stale-While-Revalidate)
Poll results are cached with a 30-second TTL. On revisit, cached data renders instantly while a background fetch checks for updates. Users never see a blank screen. Cache is invalidated after a successful vote so results are always fresh.

### 4-Step Transaction Progress Tracker
Maps directly to the real Stellar transaction lifecycle:
1. **Signing** — Freighter popup opens, user approves
2. **Broadcasting** — signed XDR sent to Horizon
3. **Confirming** — waiting for ledger close
4. **Complete** — transaction hash available, UI updates

### Error Handling (3 types)
1. **Wallet not installed** → shows install link to freighter.app
2. **User rejected** → clear message to try again and approve in Freighter
3. **Insufficient balance / network error** → specific actionable message

---

## Commit History

```
feat: complete StarVote Orange Belt dApp with Soroban contract
test: add 7 Soroban contract tests for vote, guards, accumulation
feat: add loading states, 4-step tx tracker, localStorage caching
docs: complete README with setup, deployment, architecture
docs: add live Vercel demo URL and test screenshot
docs: add demo video link
```

---

## License
MIT © 2026