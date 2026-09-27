import type { Mode } from "../env.js";
import type { Provider } from "../store/types.js";

export interface PushRequest {
  paymentId: string;
  /** 2547XXXXXXXX */
  phone: string;
  /** Whole units of `currency`. */
  amount: number;
  currency: string;
  /** Wallet provider code on the rail, e.g. pawaPay "MTN_MOMO_UGA". Direct rails ignore it. */
  walletCode?: string;
  reference: string;
  description: string;
}

export interface PushResult {
  providerRef: string;
  merchantRef?: string;
  message: string;
}

export type Outcome =
  | { status: "paid"; receipt: string | null }
  | { status: "failed" | "cancelled" | "timeout"; reason: string }
  | { status: "pending" };

/** A mobile money rail that can send a PIN prompt to a handset and report back. */
export interface MobileMoney {
  readonly name: Provider;
  readonly mode: Mode;
  push(req: PushRequest): Promise<PushResult>;
  query(providerRef: string): Promise<Outcome>;
}

export class ProviderError extends Error {
  constructor(public provider: Provider, message: string, public userMessage: string) {
    super(message);
  }
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  const raw = await res.text();
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return { raw: raw.slice(0, 300) };
  }
}
