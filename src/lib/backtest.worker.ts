import { backtestMatrix } from "./backtest";
import type { Candle } from "./market.functions";

self.onmessage = (e: MessageEvent<{ id: number; candles: Candle[] }>) => {
  const { id, candles } = e.data;
  try {
    const { standard, matrix } = backtestMatrix(candles);
    (self as unknown as Worker).postMessage({ id, result: standard, matrix });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : "Test failed" });
  }
};
