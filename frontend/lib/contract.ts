// frontend/lib/contract.ts
// Real Soroban smart contract integration

import * as StellarSdk from "@stellar/stellar-sdk";
import { signTransaction, getAddress } from "@stellar/freighter-api";

const CONTRACT_ID        = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
const RPC_URL            = process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const HORIZON_URL        = "https://horizon-testnet.stellar.org";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PollData {
  question:   string;
  options:    string[];
  results:    number[];
  totalVotes: number;
}

// ── Soroban RPC helpers ───────────────────────────────────────────────────────

function getServer() {
  return new StellarSdk.SorobanRpc.Server(RPC_URL);
}

function getHorizon() {
  return new StellarSdk.Horizon.Server(HORIZON_URL);
}

// ── Call get_results() from Soroban contract ──────────────────────────────────

export async function fetchResults(): Promise<number[]> {
  if (!CONTRACT_ID) return [111, 76, 59, 42]; // mock fallback

  const server   = getServer();
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const result = await server.simulateTransaction(
    new StellarSdk.TransactionBuilder(
      await getHorizon().loadAccount("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"),
      { fee: StellarSdk.BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE }
    )
      .addOperation(contract.call("get_results"))
      .setTimeout(30)
      .build()
  );

  if (StellarSdk.SorobanRpc.Api.isSimulationError(result)) {
    console.error("get_results failed:", result.error);
    return [0, 0, 0, 0];
  }

  const val = result.result?.retval;
  if (!val) return [0, 0, 0, 0];

  const vec = val.value() as StellarSdk.xdr.ScVal[];
  return vec.map(v => Number((v.value() as bigint)));
}

// ── Call get_question() from Soroban contract ─────────────────────────────────

export async function fetchQuestion(): Promise<string> {
  if (!CONTRACT_ID) return "What should the Stellar community prioritize in 2026?";

  const server   = getServer();
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const result = await server.simulateTransaction(
    new StellarSdk.TransactionBuilder(
      await getHorizon().loadAccount("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"),
      { fee: StellarSdk.BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE }
    )
      .addOperation(contract.call("get_question"))
      .setTimeout(30)
      .build()
  );

  if (StellarSdk.SorobanRpc.Api.isSimulationError(result)) return "";
  const val = result.result?.retval;
  return val ? val.value()?.toString() ?? "" : "";
}

// ── Call vote(option, voter) on Soroban contract ──────────────────────────────

export async function castVote(optionIndex: number): Promise<string> {
  const addrObj = await getAddress();
  if (addrObj.error) throw new Error(addrObj.error.message);
  const voter = addrObj.address;

  if (!CONTRACT_ID) {
    // Mock: simulate a Stellar transaction for demo purposes
    const horizon = getHorizon();
    const account = await horizon.loadAccount(voter);
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: voter,
          asset:       StellarSdk.Asset.native(),
          amount:      "0.0000001",
        })
      )
      .addMemo(StellarSdk.Memo.text(`starvote:option:${optionIndex}`))
      .setTimeout(30)
      .build();

    const signed = await signTransaction(tx.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE });
    if (signed.error) throw new Error(signed.error.message);

    const signedTx = StellarSdk.TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK_PASSPHRASE);
    const res = await horizon.submitTransaction(signedTx);
    return res.hash;
  }

  // Real Soroban contract call
  const server   = getServer();
  const contract = new StellarSdk.Contract(CONTRACT_ID);
  const horizon  = getHorizon();
  const account  = await horizon.loadAccount(voter);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "vote",
        StellarSdk.nativeToScVal(optionIndex, { type: "u32" }),
        StellarSdk.nativeToScVal(voter, { type: "address" })
      )
    )
    .setTimeout(30)
    .build();

  // Simulate first
  const sim = await server.simulateTransaction(tx);
  if (StellarSdk.SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Contract error: ${sim.error}`);
  }

  // Prepare and sign
  const prepared = StellarSdk.SorobanRpc.assembleTransaction(tx, sim).build();
  const signed = await signTransaction(prepared.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE });
  if (signed.error) throw new Error(signed.error.message);

  // Submit
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK_PASSPHRASE);
  const result = await server.sendTransaction(signedTx);

  if (result.status === "ERROR") throw new Error(`Transaction failed: ${result.errorResult}`);

  // Poll for confirmation
  let getResult = await server.getTransaction(result.hash);
  while (getResult.status === StellarSdk.SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
    await new Promise(r => setTimeout(r, 1000));
    getResult = await server.getTransaction(result.hash);
  }

  if (getResult.status === StellarSdk.SorobanRpc.Api.GetTransactionStatus.FAILED) {
    throw new Error("Transaction failed on chain");
  }

  return result.hash;
}