import * as StellarSdk from "@stellar/stellar-sdk";
import * as StellarSdkRpc from "@stellar/stellar-sdk/rpc";
import { signTransaction, getAddress } from "@stellar/freighter-api";

const CONTRACT_ID        = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const RPC_URL            = "https://soroban-testnet.stellar.org";
const HORIZON_URL        = "https://horizon-testnet.stellar.org";

export interface PollData {
  question:   string;
  options:    string[];
  results:    number[];
  totalVotes: number;
}

async function simulateContract(
  method: string,
  args: StellarSdk.xdr.ScVal[] = []
): Promise<StellarSdk.xdr.ScVal> {
  if (!CONTRACT_ID) throw new Error("CONTRACT_ID not set");

  const rpc           = new StellarSdkRpc.Server(RPC_URL);
  const contract      = new StellarSdk.Contract(CONTRACT_ID);
  const sourceKeypair = StellarSdk.Keypair.random();
  const sourceAccount = new StellarSdk.Account(
    sourceKeypair.publicKey(), "0"
  );

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee:               StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await rpc.simulateTransaction(tx);

  if (StellarSdkRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation error: ${simResult.error}`);
  }

  const retval = (
    simResult as StellarSdkRpc.Api.SimulateTransactionSuccessResponse
  ).result?.retval;

  if (!retval) throw new Error("No return value");
  return retval;
}

export async function fetchQuestion(): Promise<string> {
  if (!CONTRACT_ID) return "What should the Stellar community prioritize in 2026?";
  try {
    const val = await simulateContract("get_question");
    return StellarSdk.scValToNative(val) as string;
  } catch {
    return "What should the Stellar community prioritize in 2026?";
  }
}

export async function fetchOptions(): Promise<string[]> {
  if (!CONTRACT_ID) {
    return ["DeFi & DEX improvements","Cross-chain bridges",
            "Mobile wallet UX","Developer tooling"];
  }
  try {
    const val = await simulateContract("get_options");
    return val.vec()?.map(v => StellarSdk.scValToNative(v) as string) ?? [];
  } catch {
    return ["DeFi & DEX improvements","Cross-chain bridges",
            "Mobile wallet UX","Developer tooling"];
  }
}

export async function fetchResults(): Promise<number[]> {
  if (!CONTRACT_ID) return [111, 76, 59, 42];
  try {
    const val = await simulateContract("get_results");
    return val.vec()?.map(v => v.u32() ?? 0) ?? [0, 0, 0, 0];
  } catch {
    return [111, 76, 59, 42];
  }
}

export async function checkHasVoted(voterAddress: string): Promise<boolean> {
  if (!CONTRACT_ID) return false;
  try {
    const val = await simulateContract("has_voted", [
      StellarSdk.nativeToScVal(voterAddress, { type: "address" }),
    ]);
    return StellarSdk.scValToNative(val) as boolean;
  } catch {
    return false;
  }
}

export async function fetchPollData(): Promise<PollData> {
  const [question, options, results] = await Promise.all([
    fetchQuestion(), fetchOptions(), fetchResults(),
  ]);
  return {
    question, options, results,
    totalVotes: results.reduce((a, b) => a + b, 0),
  };
}

export async function castVote(optionIndex: number): Promise<string> {
  if (!CONTRACT_ID) throw new Error("Contract not configured");

  const addrResult = await getAddress();
  if (addrResult.error) throw new Error(addrResult.error.message);
  const voter = addrResult.address;

  const rpc      = new StellarSdkRpc.Server(RPC_URL);
  const horizon  = new StellarSdk.Horizon.Server(HORIZON_URL);
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const account = await horizon.loadAccount(voter);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee:               "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "vote",
        StellarSdk.nativeToScVal(optionIndex, { type: "u32" }),
        StellarSdk.nativeToScVal(voter, { type: "address" }),
      )
    )
    .setTimeout(30)
    .build();

  const simResult = await rpc.simulateTransaction(tx);
  if (StellarSdkRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = StellarSdkRpc
    .assembleTransaction(tx, simResult)
    .build();

  const signed = await signTransaction(preparedTx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  if (signed.error) throw new Error(signed.error.message);

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signed.signedTxXdr,
    NETWORK_PASSPHRASE
  );

  const sendResult = await rpc.sendTransaction(signedTx);
  if (sendResult.status === "ERROR") {
    throw new Error(`Submit failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const hash = sendResult.hash;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const status = await rpc.getTransaction(hash);
    const s = String(status.status);
    if (s === "SUCCESS") return hash;
    if (s === "FAILED") throw new Error("Transaction failed on-chain");
  }
  return hash;
}
// ── fetchTokenBalance ──────────────────────────────────────────────────────
export async function fetchTokenBalance(address: string): Promise<number> {
  const TOKEN_CONTRACT_ID = process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ?? "";
  if (!TOKEN_CONTRACT_ID) return 0;
  try {
    const val = await simulateContract("balance", [
      StellarSdk.nativeToScVal(address, { type: "address" }),
    ]);
    return Number(StellarSdk.scValToNative(val));
  } catch {
    return 0;
  }
}

// ── subscribeToVoteEvents ──────────────────────────────────────────────────
export function subscribeToVoteEvents(
  onVote: (voter: string, option: number) => void
): () => void {
  if (!CONTRACT_ID) return () => {};

  const rpc = new StellarSdkRpc.Server(RPC_URL);
  let latestLedger = 0;
  let active = true;

  const poll = async () => {
    try {
      const events = await rpc.getEvents({
        filters: [{
          type: "contract",
          contractIds: [CONTRACT_ID],
        }],
        ...(latestLedger > 0 ? { startLedger: latestLedger } : {}),
      } as Parameters<typeof rpc.getEvents>[0]);

      for (const event of (events.events ?? [])) {
        latestLedger = Math.max(latestLedger, event.ledger + 1);
        try {
          const native = StellarSdk.scValToNative(event.value);
          if (Array.isArray(native) && native.length >= 2) {
            onVote(String(native[0]), Number(native[1]));
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* network error — retry */ }
    if (active) setTimeout(poll, 5000);
  };

  poll();
  return () => { active = false; };
}