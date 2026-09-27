import { randomBytes } from "node:crypto";
import type { Provider } from "../store/types.js";
import type { MobileMoney, Outcome, PushRequest, PushResult } from "./types.js";

function receiptCode(provider: Provider): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let code = "";
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return provider === "mpesa" ? `T${code.slice(0, 9)}` : `MP${code.slice(0, 8)}`;
}

interface MockPrompt {
  ref: string;
  paymentId: string;
  phone: string;
  amount: number;
  currency: string;
  outcome: Outcome;
  timer: NodeJS.Timeout | null;
}

/**
 * Stands in for Daraja / Airtel when no credentials are set. The prompt shows up on the
 * browser phone simulator; entering a PIN there (or waiting `confirmMs`) settles it.
 */
export class MockMoney implements MobileMoney {
  readonly mode = "mock" as const;
  private prompts = new Map<string, MockPrompt>();
  onSettled: ((provider: Provider, ref: string, outcome: Outcome) => void) | null = null;

  constructor(readonly name: Provider, private confirmMs: number) {}

  async push(req: PushRequest): Promise<PushResult> {
    const ref = `MOCK-${req.paymentId}`;
    const prompt: MockPrompt = {
      ref, paymentId: req.paymentId, phone: req.phone, amount: req.amount, currency: req.currency, outcome: { status: "pending" }, timer: null,
    };
    if (this.confirmMs > 0) {
      prompt.timer = setTimeout(() => this.settle(ref, { status: "paid", receipt: receiptCode(this.name) }), this.confirmMs);
      prompt.timer.unref?.();
    }
    this.prompts.set(ref, prompt);
    return {
      providerRef: ref,
      message: "Practice mode: a pretend PIN prompt was sent. No real money moves.",
    };
  }

  async query(ref: string): Promise<Outcome> {
    return this.prompts.get(ref)?.outcome ?? { status: "pending" };
  }

  /** Open prompts for a handset, newest first. Used by the simulator to render the PIN sheet. */
  openPrompts(phone: string): Array<{ ref: string; paymentId: string; amount: number; currency: string }> {
    return [...this.prompts.values()]
      .filter((p) => p.phone === phone && p.outcome.status === "pending")
      .reverse()
      .map(({ ref, paymentId, amount, currency }) => ({ ref, paymentId, amount, currency }));
  }

  /** Simulator: the student typed a PIN (any 4 digits pass except 0000) or pressed cancel. */
  respond(ref: string, action: "pin" | "cancel", pin = ""): Outcome | null {
    const prompt = this.prompts.get(ref);
    if (!prompt || prompt.outcome.status !== "pending") return null;
    if (action === "cancel") return this.settle(ref, { status: "cancelled", reason: "Cancelled on the phone" });
    if (!/^\d{4}$/.test(pin) || pin === "0000") return this.settle(ref, { status: "failed", reason: "Wrong PIN" });
    return this.settle(ref, { status: "paid", receipt: receiptCode(this.name) });
  }

  private settle(ref: string, outcome: Outcome): Outcome | null {
    const prompt = this.prompts.get(ref);
    if (!prompt || prompt.outcome.status !== "pending") return null;
    if (prompt.timer) clearTimeout(prompt.timer);
    prompt.outcome = outcome;
    this.onSettled?.(this.name, ref, outcome);
    return outcome;
  }
}
