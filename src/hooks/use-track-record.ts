import { useEffect, useRef, useState } from "react";
import type { BtResult } from "@/lib/backtest";
import type { Candle } from "@/lib/market.functions";

type State = { status: "idle" | "running" | "done" | "error"; result: BtResult | null; error?: string };

/**
 * Runs the walk-forward track record off the main thread. Re-runs only when a
 * new candle closes (keyed on market + timeframe + second-to-last bar time),
 * not on every live price tick.
 */
export function useTrackRecord(candles: Candle[] | undefined, market: string) {
  const [state, setState] = useState<State>({ status: "idle", result: null });
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const closedKey = candles && candles.length > 2 ? `${market}:${candles.length}:${candles[candles.length - 2].time}` : null;
  const candlesRef = useRef(candles);
  candlesRef.current = candles;

  useEffect(() => {
    const w = new Worker(new URL("../lib/backtest.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<{ id: number; result?: BtResult; error?: string }>) => {
      if (e.data.id !== reqId.current) return;
      setState(e.data.error ? { status: "error", result: null, error: e.data.error } : { status: "done", result: e.data.result ?? null });
    };
    w.onerror = () => setState({ status: "error", result: null, error: "The test could not run in this browser." });
    return () => {
      w.terminate();
      workerRef.current = null;
    };
  }, []);

  // Clear stale numbers when switching market/timeframe (declared first so it runs first).
  useEffect(() => {
    setState({ status: "idle", result: null });
  }, [market]);

  useEffect(() => {
    const cs = candlesRef.current;
    if (!closedKey || !cs || !workerRef.current) return;
    const id = ++reqId.current;
    setState((s) => ({ status: "running", result: s.result }));
    workerRef.current.postMessage({ id, candles: cs });
  }, [closedKey]);

  return state;
}
