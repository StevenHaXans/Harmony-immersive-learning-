import { randomUUID } from "node:crypto";
import type { Env, Mode } from "../env.js";
import { MobileMoney, Outcome, ProviderError, PushRequest, PushResult, readJson } from "./types.js";

/**
 * pawaPay Merchant API v2: mobile-money deposits in 20 African countries through one API.
 * https://docs.pawapay.io/v2/api-reference/deposits/initiate-deposit
 *
 * The deposit callback URL is configured in the pawaPay dashboard:
 *   {PUBLIC_API_URL}/api/pay/pawapay/callback/{CALLBACK_TOKEN}
 * Callbacks are never trusted on their own: each one is confirmed with Check Deposit Status.
 */

const BASE = {
  sandbox: "https://api.sandbox.pawapay.io",
  production: "https://api.pawapay.io",
};

const FAILURES: Record<string, Outcome> = {
  PAYMENT_NOT_APPROVED: { status: "cancelled", reason: "Not approved on the phone" },
  INSUFFICIENT_BALANCE: { status: "failed", reason: "Not enough mobile money balance" },
  PAYER_NOT_FOUND: { status: "failed", reason: "This number has no account with that mobile money provider" },
  PAYER_LIMIT_REACHED: { status: "failed", reason: "The wallet's transaction limit was reached" },
  WALLET_LIMIT_REACHED: { status: "failed", reason: "The wallet's limit was reached" },
  PAYMENT_IN_PROGRESS: { status: "failed", reason: "Another payment is already waiting on this phone" },
};

export function outcomeForDeposit(data: { status?: unknown; providerTransactionId?: unknown; failureReason?: { failureCode?: unknown; failureMessage?: unknown } }): Outcome {
  switch (String(data.status ?? "")) {
    case "COMPLETED":
      return { status: "paid", receipt: data.providerTransactionId ? String(data.providerTransactionId) : null };
    case "FAILED": {
      const code = String(data.failureReason?.failureCode ?? "");
      return FAILURES[code] ?? { status: "failed", reason: String(data.failureReason?.failureMessage ?? "") || "The mobile money payment failed" };
    }
    default:
      // ACCEPTED, PROCESSING, IN_RECONCILIATION
      return { status: "pending" };
  }
}

/** Callback body is the deposit itself; only the id is used, the status is re-checked. */
export function depositIdFromCallback(body: unknown): string | null {
  const id = (body as { depositId?: unknown })?.depositId;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** pawaPay only allows letters, digits and spaces in the 4-22 character customer message. */
export function customerMessage(text: string): string {
  const clean = text.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 22).trim();
  return clean.length >= 4 ? clean : "Harmony";
}

export class PawaPay implements MobileMoney {
  readonly name = "pawapay" as const;
  readonly mode: Mode;
  private base: string;

  constructor(private env: Env, private fetchImpl: typeof fetch = fetch) {
    this.mode = env.pawapayMode;
    this.base = BASE[env.PAWAPAY_ENV];
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.env.PAWAPAY_API_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" };
  }

  async push(req: PushRequest): Promise<PushResult> {
    if (!req.walletCode) throw new ProviderError("pawapay", "pawaPay needs a provider code", "Choose your mobile money provider and try again.");
    const depositId = randomUUID();
    const res = await this.fetchImpl(`${this.base}/v2/deposits`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        depositId,
        payer: { type: "MMO", accountDetails: { phoneNumber: req.phone, provider: req.walletCode } },
        amount: String(Math.round(req.amount)),
        currency: req.currency,
        clientReferenceId: req.paymentId,
        customerMessage: customerMessage(req.description),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readJson(res);
    const status = String(body.status ?? "");
    if (res.ok && (status === "ACCEPTED" || status === "DUPLICATE_IGNORED")) {
      return { providerRef: depositId, message: "Check your phone and approve the payment with your PIN." };
    }
    const reason = body.failureReason as { failureCode?: string; failureMessage?: string } | undefined;
    const code = reason?.failureCode ?? String(res.status);
    const user =
      code === "PROVIDER_TEMPORARILY_UNAVAILABLE" ? "That mobile money provider is down right now. Please try again later."
      : code === "INVALID_PHONE_NUMBER" ? "That number doesn't match the mobile money provider. Check the number and provider."
      : code === "AMOUNT_OUT_OF_BOUNDS" ? "That amount is outside what this mobile money provider allows."
      : "The mobile money provider could not send the prompt. Please try again.";
    throw new ProviderError("pawapay", `pawaPay rejected deposit: ${code} ${reason?.failureMessage ?? ""}`.trim(), user);
  }

  async query(depositId: string): Promise<Outcome> {
    const res = await this.fetchImpl(`${this.base}/v2/deposits/${encodeURIComponent(depositId)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await readJson(res);
    if (!res.ok || body.status !== "FOUND" || !body.data) return { status: "pending" };
    return outcomeForDeposit(body.data as Parameters<typeof outcomeForDeposit>[0]);
  }

  /** Asks pawaPay which provider a number belongs to. Returns null if it cannot tell. */
  async predict(phone: string): Promise<{ provider: string; phoneNumber: string; country: string } | null> {
    try {
      const res = await this.fetchImpl(`${this.base}/v2/predict-provider`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ phoneNumber: phone }),
        signal: AbortSignal.timeout(8_000),
      });
      const body = await readJson(res);
      if (!res.ok || typeof body.provider !== "string") return null;
      return { provider: body.provider, phoneNumber: String(body.phoneNumber ?? phone), country: String(body.country ?? "") };
    } catch {
      return null;
    }
  }
}
