// frontend/lib/contract.ts - Mock implementation for polling
import * as StellarSdk from "@stellar/stellar-sdk";
import { signTransaction, getAddress } from "@stellar/freighter-api";

const CONTRACT_ID        = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
const TOKEN_CONTRACT_ID  = process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ?? "";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const HORIZON_URL        = "https://horizon-testnet.stellar.org";

export interface PollData {
  question:   string;
  options:    string[];
  results:    number[];
  totalVotes: number;
}

// ── Mock data ──────────────────────────────────────────────────────────────
const MOCK_QUESTION = "What should the Stellar community prioritize in 2026?";
const MOCK_OPTIONS = [
  "DeFi & DEX improvements",
  "Cross-chain bridges",
  "Mobile wallet UX",
  "Developer tooling",
];
const MOCK_RESULTS = [111, 76, 59, 42];

export async function fetchResults(): Promise<number[]> {
  // Mock implementation - always returns mock results
  return MOCK_RESULTS;
}

export async function fetchQuestion(): Promise<string> {
  // Mock implementation
  return MOCK_QUESTION;
}

export async function fetchOptions(): Promise<string[]> {
  // Mock implementation
  return MOCK_OPTIONS;
}

export async function checkHasVoted(voterAddress: string): Promise<boolean> {
  // Mock implementation - always returns false
  return false;
}

// ── fetch STAR token balance ───────────────────────────────────────────────
export async function fetchTokenBalance(address: string): Promise<number> {
  // Mock implementation
  return Math.floor(Math.random() * 100000);
}

export async function fetchPollData(): Promise<PollData> {
  const [question, options, results] = await Promise.all([
    fetchQuestion(), 
    fetchOptions(), 
    fetchResults(),
  ]);
  return { 
    question, 
    options, 
    results, 
    totalVotes: results.reduce((a, b) => a + b, 0) 
  };
}

// ── Real-time event streaming (no-op) ──────────────────────────────────────
export function subscribeToVoteEvents(
  onVote: (voter: string, option: number) => void
): () => void {
  // Mock implementation - return unsubscribe function that does nothing
  return () => {};
}

// ── castVote - Sign mock transaction ───────────────────────────────────────
export async function castVote(optionIndex: number): Promise<string> {
  const addrObj = await getAddress();
  if (addrObj.error) throw new Error(addrObj.error.message);
  const voter = addrObj.address;

  const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);
  try {
    const account = await horizon.loadAccount(voter);

    // Create a mock transaction
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(StellarSdk.Operation.payment({
        destination: voter,
        asset: StellarSdk.Asset.native(),
        amount: "0.0000001",
      }))
      .addMemo(StellarSdk.Memo.text(`starvote:vote:${optionIndex}`))
      .setTimeout(30)
      .build();

    await signTransaction(tx.toXDR(), {
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    // Return a mock hash
    const mockHash = StellarSdk.Keypair.random().publicKey().slice(0, 64);
    return mockHash;
  } catch (e) {
    // If Horizon fails, return a mock hash anyway
    const mockHash = StellarSdk.Keypair.random().publicKey().slice(0, 64);
    return mockHash;
  }
}

