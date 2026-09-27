import { type Env, mockAllowed } from "../env.js";
import type { Messenger } from "../comms/africastalking.js";
import { HttpError } from "../http.js";
import { COUNTRIES, Country, Wallet, countryByCode, money, walletById, walletByPawapay } from "../lib/countries.js";
import { countryOf, maskPhone, networkOf, normalizePhone } from "../lib/phone.js";
import type { Channel, MobilePayment, Provider, Store } from "../store/types.js";
import { parseAirtelCallback } from "./airtel.js";
import { parseStkCallback } from "./mpesa.js";
import { depositIdFromCallback, PawaPay } from "./pawapay.js";
import { MobileMoney, Outcome, ProviderError } from "./types.js";

// Ask the provider directly once a prompt has been open this long without a callback.
const QUERY_AFTER_MS = 20_000;
// Customers get about a minute to enter a PIN; after this we stop waiting.
const GIVE_UP_AFTER_MS = 3 * 60_000;

const THANKS: Record<string, string> = {
  KE: "Asante!", TZ: "Asante!", UG: "Asante!", RW: "Murakoze!",
  CI: "Merci !", SN: "Merci !", BJ: "Merci !", BF: "Merci !", CM: "Merci !", CG: "Merci !", GA: "Merci !", CD: "Merci !",
  MZ: "Obrigado!",
};

export interface StartPayment {
  phone: unknown;
  amount: unknown;
  /** Wallet id from lib/countries.ts (mpesa, mtn, airtel, orange...). Detected from the number when omitted. */
  wallet?: string;
  /** USSD gateways report the caller's network (MCC+MNC); the most reliable network signal. */
  mccmnc?: string;
  purpose?: string;
  channel: Channel;
}

export interface PaymentView {
  id: string;
  provider: Provider;
  providerLabel: string;
  wallet: string;
  country: string;
  countryName: string;
  phone: string;
  amount: number;
  currency: string;
  amountLabel: string;
  status: MobilePayment["status"];
  receipt: string | null;
  failureReason: string | null;
  purpose: string;
  createdAt: string;
  mode: string;
  message?: string;
}

export function walletLabel(countryCode: string, walletId: string): string {
  const c = countryByCode(countryCode);
  return (c && walletById(c, walletId)?.label) || walletId;
}

export class Payments {
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private env: Env,
    private store: Store,
    private messenger: Messenger,
    readonly providers: Record<Provider, MobileMoney>,
    private now: () => number = Date.now
  ) {}

  view(p: MobilePayment, message?: string): PaymentView {
    const c = countryByCode(p.country);
    return {
      id: p.id,
      provider: p.provider,
      providerLabel: walletLabel(p.country, p.wallet),
      wallet: p.wallet,
      country: p.country,
      countryName: c?.name ?? p.country,
      phone: maskPhone(p.phone),
      amount: p.amount,
      currency: p.currency,
      amountLabel: money(p.amount, p.currency),
      status: p.status,
      receipt: p.receipt,
      failureReason: p.failureReason,
      purpose: p.purpose,
      createdAt: p.createdAt.toISOString(),
      mode: this.providers[p.provider].mode,
      ...(message ? { message } : {}),
    };
  }

  /** The rail that would carry this wallet right now, or null if none is usable. */
  railFor(wallet: Wallet): Provider | null {
    const live = (p: Provider) => this.providers[p].mode !== "mock";
    if (wallet.direct && live(wallet.direct)) return wallet.direct;
    if (wallet.pawapay && live("pawapay")) return "pawapay";
    if (!mockAllowed(this.env)) return null;
    return wallet.direct ?? (wallet.pawapay ? "pawapay" : null);
  }

  available(countryCode: string, walletId: string): boolean {
    const c = countryByCode(countryCode);
    const w = c && walletById(c, walletId);
    return !!(w && this.railFor(w));
  }

  /** Wallets per country with whether each can take payments on this server. */
  catalogue(): Array<{ country: Country; wallets: Array<Wallet & { available: boolean; rail: Provider | null }> }> {
    return COUNTRIES.map((country) => ({
      country,
      wallets: country.wallets.map((w) => {
        const rail = this.railFor(w);
        return { ...w, available: !!rail, rail };
      }),
    }));
  }

  /**
   * Which wallet a number belongs to: the network from the gateway or the number's prefix,
   * then pawaPay's own prediction when it is live. Null means "ask the student".
   */
  async detectWallet(phone: string, mccmnc?: string): Promise<Wallet | null> {
    const c = countryOf(phone);
    if (!c) return null;
    const network = networkOf(phone, mccmnc);
    if (network !== "unknown") return c.wallets.find((w) => w.network === network) ?? null;
    if (this.providers.pawapay.mode !== "mock" && this.providers.pawapay instanceof PawaPay) {
      const predicted = await this.providers.pawapay.predict(normalizePhone(phone));
      const hit = predicted && walletByPawapay(predicted.provider);
      if (hit && hit.country.code === c.code) return hit.wallet;
    }
    return c.wallets.length === 1 ? c.wallets[0] : null;
  }

  async start(input: StartPayment): Promise<{ payment: MobilePayment; message: string }> {
    const phone = normalizePhone(input.phone);
    const country = phone ? countryOf(phone) : null;
    if (!phone || !country) throw new HttpError(400, "Enter a valid mobile number, with the country code if it's not a local number");
    if (!country.wallets.length) throw new HttpError(400, `Mobile money isn't available for ${country.name} yet`);

    let wallet: Wallet | null = null;
    if (input.wallet) {
      wallet = walletById(country, input.wallet);
      if (!wallet) throw new HttpError(400, `Choose one of: ${country.wallets.map((w) => w.label).join(", ")}`);
      const network = networkOf(phone, input.mccmnc);
      const own = country.wallets.find((w) => w.network === network);
      if (network !== "unknown" && own && own.id !== wallet.id) {
        throw new HttpError(400, `That looks like a ${country.networks.find((n) => n.id === network)?.name ?? network} number. Switch to ${own.label} or use another number.`);
      }
    } else {
      wallet = await this.detectWallet(phone, input.mccmnc);
      if (!wallet) {
        const network = networkOf(phone, input.mccmnc);
        if (network !== "unknown") {
          throw new HttpError(400, `Mobile money here works with ${country.wallets.map((w) => w.label).join(" or ")}. Use a line from one of those networks.`);
        }
        throw new HttpError(400, `Choose your mobile money: ${country.wallets.map((w) => w.label).join(" or ")}`);
      }
    }

    const rail = this.railFor(wallet);
    if (!rail) throw new HttpError(503, `${wallet.label} is not set up on this server yet`);

    const amount = Number(input.amount);
    if (!Number.isInteger(amount) || amount < country.min || amount > country.max) {
      throw new HttpError(400, `Amount must be a whole number between ${money(country.min, country.currency)} and ${money(country.max, country.currency)}`);
    }

    const purpose = (input.purpose || "restoration").replace(/[^a-z0-9 _-]/gi, "").slice(0, 40) || "restoration";
    const payment = await this.store.createPayment({
      provider: rail, phone, country: country.code, wallet: wallet.id, amount, currency: country.currency, purpose, channel: input.channel,
    });

    try {
      const pushed = await this.providers[rail].push({
        paymentId: payment.id,
        phone,
        amount,
        currency: country.currency,
        walletCode: wallet.pawapay,
        reference: this.env.MPESA_ACCOUNT_REF,
        description: "Harmony coast",
      });
      const updated = await this.store.updatePayment(payment.id, {
        providerRef: pushed.providerRef,
        merchantRef: pushed.merchantRef || null,
      });
      console.log(`[pay] ${wallet.label} via ${rail} prompt sent to ${maskPhone(phone)} for ${money(amount, country.currency)} (${payment.id})`);
      return { payment: updated ?? payment, message: pushed.message };
    } catch (err) {
      const reason = err instanceof ProviderError ? err.userMessage : "Could not reach the payment provider";
      console.warn(`[pay] ${rail} push failed (${payment.id}):`, (err as Error).message);
      await this.store.settlePayment(payment.id, { status: "failed", failureReason: reason });
      throw new HttpError(502, reason);
    }
  }

  /** Current state, asking the provider directly if the callback is late. */
  async refresh(id: string): Promise<MobilePayment | null> {
    const payment = await this.store.getPayment(id);
    if (!payment || payment.status !== "pending" || !payment.providerRef) return payment;
    const age = this.now() - payment.createdAt.getTime();
    if (age < QUERY_AFTER_MS && this.providers[payment.provider].mode !== "mock") return payment;

    let outcome: Outcome = { status: "pending" };
    try {
      outcome = await this.providers[payment.provider].query(payment.providerRef);
    } catch (err) {
      console.warn(`[pay] status query failed (${payment.id}):`, (err as Error).message);
    }
    if (outcome.status === "pending" && age > GIVE_UP_AFTER_MS) {
      outcome = { status: "timeout", reason: "No response from the phone. Nothing was charged." };
    }
    if (outcome.status === "pending") return payment;
    return (await this.apply(payment, outcome)) ?? (await this.store.getPayment(id));
  }

  async onProviderOutcome(provider: Provider, providerRef: string, outcome: Outcome): Promise<MobilePayment | null> {
    const payment = await this.store.findPaymentByRef(provider, providerRef);
    if (!payment) {
      console.warn(`[pay] ${provider} callback for unknown ref ${providerRef}`);
      return null;
    }
    return this.apply(payment, outcome);
  }

  async handleMpesaCallback(body: unknown): Promise<boolean> {
    const parsed = parseStkCallback(body);
    if (!parsed) return false;
    await this.onProviderOutcome("mpesa", parsed.checkoutRequestId, parsed.outcome);
    return true;
  }

  async handleAirtelCallback(body: unknown): Promise<boolean> {
    const parsed = parseAirtelCallback(body);
    if (!parsed) return false;
    await this.onProviderOutcome("airtel", parsed.transactionId, parsed.outcome);
    return true;
  }

  /** pawaPay callbacks only say "look at deposit X"; the status comes from pawaPay's API. */
  async handlePawapayCallback(body: unknown): Promise<boolean> {
    const depositId = depositIdFromCallback(body);
    if (!depositId) return false;
    const payment = await this.store.findPaymentByRef("pawapay", depositId);
    if (!payment) {
      console.warn(`[pay] pawapay callback for unknown deposit ${depositId}`);
      return true;
    }
    const outcome = await this.providers.pawapay.query(depositId);
    if (outcome.status !== "pending") await this.apply(payment, outcome);
    return true;
  }

  private async apply(payment: MobilePayment, outcome: Outcome): Promise<MobilePayment | null> {
    if (outcome.status === "pending") return payment;
    const settled = await this.store.settlePayment(
      payment.id,
      outcome.status === "paid"
        ? { status: "paid", receipt: outcome.receipt ?? payment.receipt }
        : { status: outcome.status, failureReason: outcome.reason }
    );
    if (!settled) return null; // already settled by the callback or a poll
    console.log(`[pay] ${settled.id} -> ${settled.status}`);
    await this.notify(settled);
    return settled;
  }

  private async notify(p: MobilePayment): Promise<void> {
    const label = walletLabel(p.country, p.wallet);
    const amount = money(p.amount, p.currency);
    if (p.status === "paid") {
      const ref = p.receipt ? ` Ref ${p.receipt}.` : "";
      const thanks = THANKS[p.country] ?? "Thank you!";
      await this.messenger.sendSms(p.phone, `${thanks} ${amount} received via ${label}.${ref} Your support helps plant mangroves and restore Africa's coasts. - Harmony`);
      return;
    }
    // Web users see the result on screen; feature-phone users need to hear back.
    if (p.channel !== "web") {
      await this.messenger.sendSms(
        p.phone,
        `Harmony: your ${label} payment of ${amount} did not go through (${p.failureReason ?? p.status}). Nothing was charged. Dial ${this.env.USSD_CODE} to try again.`
      );
    }
  }

  startSweeper(intervalMs = 30_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      void this.sweep().catch((err) => console.warn("[pay] sweep failed:", (err as Error).message));
    }, intervalMs);
    this.sweeper.unref?.();
  }

  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  async sweep(): Promise<void> {
    const stale = await this.store.listPending(new Date(this.now() - QUERY_AFTER_MS), 25);
    for (const p of stale) await this.refresh(p.id);
  }
}
