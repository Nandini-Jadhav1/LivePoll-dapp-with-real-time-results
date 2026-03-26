"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { isConnected, requestAccess, getAddress } from "@stellar/freighter-api";
import { castVote, fetchResults } from "../lib/contract";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PollOption { label: string; emoji: string; }
interface PollState {
  question: string; options: PollOption[];
  results: number[]; totalVotes: number; daysLeft: number;
}
type WalletStatus = "disconnected" | "connecting" | "connected" | "error";
type VoteStatus   = "idle" | "signing" | "submitting" | "confirming" | "success" | "error";

// ── Config ────────────────────────────────────────────────────────────────────

const CACHE_KEY          = "starvote_v1";
const CACHE_TTL          = 30_000;

// ── Cache ─────────────────────────────────────────────────────────────────────

function readCache(): PollState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return Date.now() - ts < CACHE_TTL ? data : null;
  } catch { return null; }
}
function writeCache(data: PollState) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); }
  catch { /* ignore */ }
}

// ── Mock poll ─────────────────────────────────────────────────────────────────

const MOCK_POLL: PollState = {
  question:   "What should the Stellar community prioritize in 2026?",
  options: [
    { label: "DeFi & DEX improvements", emoji: "⚡" },
    { label: "Cross-chain bridges",      emoji: "🌐" },
    { label: "Mobile wallet UX",         emoji: "📱" },
    { label: "Developer tooling",        emoji: "🛠️" },
  ],
  results:    [111, 76, 59, 42],
  totalVotes: 288,
  daysLeft:   8,
};

const BAR_COLORS = ["bg-cyan-500", "bg-purple-500", "bg-yellow-500", "bg-green-500"];

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ size = "sm" }: { size?: "sm" | "md" }) {
  const s = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
  return (
    <svg className={`${s} animate-spin flex-shrink-0`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [poll,         setPoll]         = useState<PollState | null>(null);
  const [isLoadingPoll,setIsLoadingPoll]= useState(true);
  const [walletStatus, setWalletStatus] = useState<WalletStatus>("disconnected");
  const [address,      setAddress]      = useState<string | null>(null);
  const [walletError,  setWalletError]  = useState<string | null>(null);
  const [hasVoted,     setHasVoted]     = useState(false);
  const [votedIdx,     setVotedIdx]     = useState<number | null>(null);
  const [voteStatus,   setVoteStatus]   = useState<VoteStatus>("idle");
  const [voteError,    setVoteError]    = useState<string | null>(null);
  const [txHash,       setTxHash]       = useState<string | null>(null);
  const fetchRef = useRef(false);

  // ── Load poll ───────────────────────────────────────────────────────────────
  const loadPoll = useCallback(async () => {
    if (fetchRef.current) return;
    fetchRef.current = true;
    const cached = readCache();
    if (cached) { setPoll(cached); setIsLoadingPoll(false); fetchRef.current = false; return; }
    try {
      await new Promise(r => setTimeout(r, 600)); // simulate RPC
      setPoll(MOCK_POLL);
      writeCache(MOCK_POLL);
    } catch { setPoll(MOCK_POLL); }
    finally { setIsLoadingPoll(false); fetchRef.current = false; }
  }, []);

  useEffect(() => { loadPoll(); }, [loadPoll]);

  // ── Auto-reconnect ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await isConnected();
        if (r.isConnected) {
          const a = await getAddress();
          if (!a.error && a.address) { setAddress(a.address); setWalletStatus("connected"); }
        }
      } catch { /* Freighter not installed */ }
    })();
  }, []);

  // ── Connect wallet — opens Freighter popup ──────────────────────────────────
  const connect = useCallback(async () => {
    setWalletError(null);
    setWalletStatus("connecting");
    try {
      const conn = await isConnected();
      if (!conn.isConnected) {
        setWalletError("Freighter not installed. Visit freighter.app to install.");
        setWalletStatus("error");
        return;
      }
      // 👇 This line opens the Freighter popup
      const access = await requestAccess();
      if (access.error) {
        setWalletError("You rejected the connection. Please try again and click Approve.");
        setWalletStatus("error");
        return;
      }
      setAddress(access.address);
      setWalletStatus("connected");
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : "Connection failed.");
      setWalletStatus("error");
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null); setWalletStatus("disconnected"); setWalletError(null);
    setHasVoted(false); setVotedIdx(null); setVoteStatus("idle");
    setVoteError(null); setTxHash(null);
  }, []);

  // ── Vote — signs & submits real Stellar transaction ─────────────────────────
  const vote = useCallback(async (optionIdx: number) => {
    if (!address || hasVoted || voteStatus !== "idle") return;
    setVoteError(null); setTxHash(null);
    try {
      setVoteStatus("signing");
      const hash = await castVote(optionIdx);
      setVoteStatus("submitting");
      await new Promise(r => setTimeout(r, 500));
      setVoteStatus("confirming");
      const results = await fetchResults();
      setPoll(prev => {
        if (!prev) return prev;
        return { ...prev, results, totalVotes: results.reduce((a,b) => a+b, 0) };
      });
      setVotedIdx(optionIdx);
      setHasVoted(true);
      setTxHash(hash);
      setVoteStatus("success");
    } catch (e) {
      setVoteStatus("error");
      setVoteError(e instanceof Error ? e.message : "Vote failed.");
    }
  }, [address, hasVoted, voteStatus]);

  const pct = (i: number) => {
    if (!poll || poll.totalVotes === 0) return 0;
    return Math.round(((poll.results[i] ?? 0) / poll.totalVotes) * 100);
  };

  const TX_STEPS: { key: VoteStatus; label: string }[] = [
    { key: "signing",    label: "Signing transaction in Freighter" },
    { key: "submitting", label: "Broadcasting to Stellar network" },
    { key: "confirming", label: "Waiting for confirmation" },
    { key: "success",    label: "Vote recorded on-chain!" },
  ];
  const stepOrder = TX_STEPS.map(s => s.key);
  const currentStepIdx = stepOrder.indexOf(voteStatus);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-gray-100">

      {/* Nav */}
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-yellow-400 text-xl">⭐</span>
          <span className="font-bold text-white tracking-wide">StarVote</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2 py-1 rounded border border-cyan-700 text-cyan-400">TESTNET</span>
          {walletStatus === "connected" && address ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono">{address.slice(0,6)}…{address.slice(-4)}</span>
              <button onClick={disconnect} className="text-xs text-rose-400 hover:text-rose-300 transition-colors">
                Disconnect
              </button>
            </div>
          ) : (
            <span className="text-xs text-gray-500">Not connected</span>
          )}
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* ── Left Panel ── */}
        <div className="space-y-4">

          {/* Wallet Card */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
              🔌 Connect Wallet
            </h3>

            {walletStatus === "connected" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-900/30 border border-emerald-800">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"/>
                  <span className="text-xs text-emerald-300 font-medium">Freighter connected ✓</span>
                </div>
                <p className="text-xs text-gray-500 font-mono break-all">{address}</p>
                <button onClick={disconnect}
                  className="w-full py-2 rounded-lg border border-rose-800 text-rose-400 text-xs hover:bg-rose-900/20 transition-colors">
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-2">

                {/* ── FREIGHTER — real connect button ── */}
                <div className="rounded-lg border border-indigo-600 bg-gray-800 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-base flex-shrink-0">🚀</div>
                    <div>
                      <p className="text-sm font-semibold text-white">Freighter</p>
                      <p className="text-xs text-gray-500">Most popular Stellar wallet</p>
                    </div>
                  </div>
                  <button
                    onClick={connect}
                    disabled={walletStatus === "connecting"}
                    className="w-full flex items-center justify-center gap-2 py-2.5
                               bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700
                               text-white text-sm font-bold transition-colors
                               disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {walletStatus === "connecting"
                      ? <><Spinner size="sm"/> Connecting…</>
                      : <>🔗 Connect</>
                    }
                  </button>
                </div>

                {/* Other wallets (UI only — not active) */}
                {[
                  { name: "xBull",  desc: "Advanced Stellar wallet",  emoji: "🐂" },
                  { name: "Rabet",  desc: "Browser extension wallet",  emoji: "🔷" },
                  { name: "Lobstr", desc: "Mobile-friendly wallet",    emoji: "🦞" },
                ].map(w => (
                  <div key={w.name}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg bg-gray-800/50 border border-gray-800 opacity-50">
                    <div className="h-8 w-8 rounded-lg bg-gray-700 flex items-center justify-center text-base flex-shrink-0">{w.emoji}</div>
                    <div>
                      <p className="text-sm text-gray-400">{w.name}</p>
                      <p className="text-xs text-gray-600">{w.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {walletError && (
              <div className="mt-3 rounded-lg border border-rose-800 bg-rose-900/20 px-3 py-2 text-xs text-rose-400">
                ⚠️ {walletError}
                {walletError.includes("freighter.app") && (
                  <a href="https://freighter.app" target="_blank" rel="noopener noreferrer"
                    className="ml-1 underline font-bold">Install ↗</a>
                )}
              </div>
            )}
          </div>

          {/* Contract Info */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">📋 Contract Info</h3>
            <div className="space-y-2 text-xs">
              {[
                { label: "Contract ID",   value: "LIVE_POLL", color: "text-cyan-400" },
                { label: "Network",       value: "Stellar Testnet",  color: "text-emerald-400" },
                { label: "Horizon URL",   value: "horizon-testnet",  color: "text-blue-400" },
                { label: "Contract Func", value: "castVote()", color: "text-purple-400" },
                { label: "Total Votes",   value: poll?.totalVotes?.toString() ?? "—", color: "text-white" },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center">
                  <span className="text-gray-500">{row.label}</span>
                  <span className={`font-mono ${row.color}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Panel ── */}
        <div className="md:col-span-2 space-y-4">

          {/* Poll card */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse"/>
              <span className="text-xs font-semibold text-red-400 uppercase tracking-widest">Live Poll</span>
            </div>

            {isLoadingPoll ? (
              <div className="flex items-center gap-3 py-10">
                <Spinner size="md"/>
                <span className="text-gray-400 text-sm">Loading poll from chain…</span>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-white leading-tight mb-2">{poll?.question}</h2>
                <div className="flex items-center gap-4 text-xs text-gray-500 mb-6">
                  <span>🗳️ {poll?.totalVotes} votes</span>
                  <span>⏱️ {poll?.daysLeft} days remaining</span>
                  <span>📄 {process.env.NEXT_PUBLIC_CONTRACT_ID ? "Contract deployed" : "Mock mode"}</span>
                </div>

                {/* Vote options */}
                {walletStatus === "connected" && !hasVoted && (
                  <div className="space-y-2 mb-4">
                    {poll?.options.map((opt, i) => (
                      <button key={i} onClick={() => vote(i)}
                        disabled={voteStatus !== "idle"}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg
                                   border border-gray-700 bg-gray-800 hover:border-cyan-600
                                   hover:bg-gray-700 transition-all text-sm text-left
                                   disabled:opacity-50 disabled:cursor-not-allowed">
                        <span className="text-lg">{opt.emoji}</span>
                        <span className="text-gray-200 flex-1">{opt.label}</span>
                        {voteStatus !== "idle" && <Spinner size="sm"/>}
                      </button>
                    ))}
                  </div>
                )}

                {/* Not connected prompt */}
                {walletStatus !== "connected" && (
                  <div className="flex flex-col items-center gap-3 py-8 border border-dashed border-gray-700 rounded-xl mb-4">
                    <span className="text-3xl">🔗</span>
                    <p className="text-gray-400 text-sm text-center">
                      Click <strong className="text-indigo-400">Connect</strong> in the left panel to cast your vote on-chain
                    </p>
                  </div>
                )}

                {/* Voted badge */}
                {hasVoted && votedIdx !== null && (
                  <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-900/30 border border-emerald-800 text-emerald-400 text-xs">
                    ✓ You voted for: <strong>{poll?.options[votedIdx]?.label}</strong>
                  </div>
                )}

                {/* Vote status messages */}
                {voteStatus === "signing" && (
                  <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg border border-indigo-700 bg-indigo-900/30 text-indigo-300 text-sm">
                    <Spinner size="sm"/> Please approve the transaction in your Freighter popup…
                  </div>
                )}
                {voteStatus === "submitting" && (
                  <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg border border-blue-700 bg-blue-900/30 text-blue-300 text-sm">
                    <Spinner size="sm"/> Broadcasting transaction to Stellar testnet…
                  </div>
                )}
                {voteStatus === "confirming" && (
                  <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg border border-yellow-700 bg-yellow-900/30 text-yellow-300 text-sm">
                    <Spinner size="sm"/> Confirming on-chain…
                  </div>
                )}
                {voteStatus === "success" && (
                  <div className="mb-4 px-4 py-3 rounded-lg border border-emerald-700 bg-emerald-900/30 text-emerald-300 text-sm">
                    🎉 Vote confirmed on Stellar testnet!
                    {txHash && (
                      <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                        target="_blank" rel="noopener noreferrer"
                        className="ml-2 underline text-xs opacity-80 hover:opacity-100">
                        View transaction ↗
                      </a>
                    )}
                  </div>
                )}
                {voteStatus === "error" && voteError && (
                  <div className="mb-4 px-4 py-3 rounded-lg border border-rose-700 bg-rose-900/30 text-rose-300 text-sm">
                    ❌ {voteError}
                    <button onClick={() => { setVoteStatus("idle"); setVoteError(null); }}
                      className="ml-2 underline text-xs">Try again</button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Live Results */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-6">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center justify-between">
              📊 Live Results
              <button onClick={() => { localStorage.removeItem(CACHE_KEY); loadPoll(); }}
                className="text-xs text-gray-500 hover:text-cyan-400 transition-colors">⟳ Refresh</button>
            </h3>
            <div className="space-y-3">
              {poll?.options.map((opt, i) => {
                const p = pct(i);
                return (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="flex items-center gap-2 text-gray-300">
                        {opt.emoji} {opt.label}
                        {votedIdx === i && <span className="text-xs text-emerald-400">✓ your vote</span>}
                      </span>
                      <span className="text-gray-500 font-mono">{p}%</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-gray-800 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${BAR_COLORS[i % BAR_COLORS.length]}`}
                        style={{ width: `${p}%` }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Transaction Status */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-6">
            <h3 className="text-sm font-semibold text-white mb-4">⚡ Transaction Status</h3>
            {voteStatus === "idle" && !txHash ? (
              <p className="text-xs text-gray-600">No transaction yet. Cast your vote to see live status here.</p>
            ) : (
              <div className="space-y-3">
                {TX_STEPS.map((step, i) => {
                  const done   = currentStepIdx > i || voteStatus === "success";
                  const active = currentStepIdx === i && voteStatus !== "success" && voteStatus !== "error";
                  return (
                    <div key={step.key} className="flex items-center gap-3">
                      <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                        ${done   ? "bg-emerald-600 text-white"
                        : active  ? "bg-indigo-600 text-white"
                                  : "bg-gray-800 text-gray-600"}`}>
                        {done ? "✓" : active ? <Spinner size="sm"/> : i + 1}
                      </div>
                      <span className={`text-xs ${done ? "text-emerald-400" : active ? "text-indigo-300" : "text-gray-600"}`}>
                        {step.label}
                      </span>
                    </div>
                  );
                })}
                {txHash && (
                  <div className="mt-3 p-3 rounded-lg bg-gray-800 border border-gray-700">
                    <p className="text-xs text-gray-500 mb-1">Transaction Hash:</p>
                    <p className="text-xs text-cyan-400 font-mono break-all">{txHash}</p>
                    <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-indigo-400 hover:text-indigo-300 underline mt-1 inline-block">
                      View on Stellar Expert ↗
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
 
