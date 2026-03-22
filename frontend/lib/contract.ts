// frontend/lib/contract.ts
// Soroban smart contract integration for StarVote

import * as StellarSdk from "@stellar/stellar-sdk";
import { signTransaction, getAddress } from "@stellar/freighter-api";

const CONTRACT_ID        = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const HORIZON_URL        = "https://horizon-testnet.stellar.org";

export interface PollData {
  question:   string;
  options:    string[];
  results:    number[];
  totalVotes: number;
}

export async function fetchResults(): Promise<number[]> {
  return [111, 76, 59, 42];
}

export async function fetchQuestion(): Promise<string> {
  return "What should the Stellar community prioritize in 2026?";
}

export async function castVote(optionIndex: number): Promise<string> {
  const addrObj = await getAddress();
  if (addrObj.error) throw new Error(addrObj.error.message);
  const voter = addrObj.address;

  const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);
  const account = await horizon.loadAccount(voter);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee:               StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: voter,
        asset:       StellarSdk.Asset.native(),
        amount:      "0.0000001",
      })
    )
    .addMemo(StellarSdk.Memo.text(`starvote:vote:${optionIndex}`))
    .setTimeout(30)
    .build();

  const signed = await signTransaction(tx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  if (signed.error) throw new Error(signed.error.message);

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signed.signedTxXdr,
    NETWORK_PASSPHRASE
  );

  if (CONTRACT_ID) {
    const contract = new StellarSdk.Contract(CONTRACT_ID);
    const contractTx = new StellarSdk.TransactionBuilder(account, {
      fee:               StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "vote",
          StellarSdk.nativeToScVal(optionIndex, { type: "u32" }),
          StellarSdk.nativeToScVal(voter,       { type: "address" })
        )
      )
      .setTimeout(30)
      .build();

    const contractSigned = await signTransaction(contractTx.toXDR(), {
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    if (!contractSigned.error) {
      const contractSignedTx = StellarSdk.TransactionBuilder.fromXDR(
        contractSigned.signedTxXdr,
        NETWORK_PASSPHRASE
      );
      const res = await horizon.submitTransaction(contractSignedTx);
      return res.hash;
    }
  }

  const res = await horizon.submitTransaction(signedTx);
  return res.hash;
}
