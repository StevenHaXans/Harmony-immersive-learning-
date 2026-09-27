import type { Env, Mode } from "../env.js";
import { e164, maskPhone, normalizePhone } from "../lib/phone.js";
import { forSms } from "../lib/text.js";
import type { Store } from "../store/types.js";

/**
 * Africa's Talking: outbound SMS and outbound (callback) voice calls.
 * Inbound SMS, USSD and voice arrive as webhooks, see channels/.
 * https://developers.africastalking.com/docs/sms/sending  ·  /docs/voice/call
 */

export interface OutboxItem {
  id: string;
  phone: string;
  kind: "sms" | "call";
  body: string;
  at: string;
}

export interface Messenger {
  readonly smsMode: Mode;
  readonly voiceMode: Mode;
  sendSms(phone: string, message: string): Promise<{ ok: boolean; id: string | null }>;
  /** Rings the student from our voice number. `tag` comes back on the voice webhook as clientRequestId. */
  call(phone: string, tag: string): Promise<{ ok: boolean }>;
  /** Mock-mode outbox, shown in the simulator. Empty when talking to the real gateway. */
  outbox(phone: string | null, limit: number): OutboxItem[];
}

export class AfricasTalking implements Messenger {
  readonly smsMode: Mode;
  readonly voiceMode: Mode;
  private mockOutbox: OutboxItem[] = [];
  private seq = 0;

  constructor(private env: Env, private store: Store, private fetchImpl: typeof fetch = fetch) {
    this.smsMode = env.smsMode;
    this.voiceMode = env.voiceMode;
  }

  private smsUrl(): string {
    return this.smsMode === "sandbox"
      ? "https://api.sandbox.africastalking.com/version1/messaging"
      : "https://api.africastalking.com/version1/messaging";
  }

  private voiceUrl(): string {
    return this.voiceMode === "sandbox"
      ? "https://voice.sandbox.africastalking.com/call"
      : "https://voice.africastalking.com/call";
  }

  private push(phone: string, kind: OutboxItem["kind"], body: string): OutboxItem {
    const item = { id: `out_${++this.seq}`, phone, kind, body, at: new Date().toISOString() };
    this.mockOutbox.push(item);
    if (this.mockOutbox.length > 500) this.mockOutbox.splice(0, this.mockOutbox.length - 500);
    return item;
  }

  async sendSms(rawPhone: string, message: string): Promise<{ ok: boolean; id: string | null }> {
    const body = forSms(message);
    const phone = normalizePhone(rawPhone);
    const to = e164(phone);
    if (!to || !body) return { ok: false, id: null };

    if (this.smsMode === "mock") {
      const item = this.push(phone, "sms", body);
      console.log(`[sms:mock] -> ${maskPhone(phone)}: ${body}`);
      await this.store.logMessage({ direction: "out", channel: "sms", phone, body, status: "mock", providerId: item.id });
      return { ok: true, id: item.id };
    }

    const form = new URLSearchParams({ username: this.env.AT_USERNAME, to, message: body });
    if (this.env.AT_SMS_FROM) form.set("from", this.env.AT_SMS_FROM);
    try {
      const res = await this.fetchImpl(this.smsUrl(), {
        method: "POST",
        headers: { apiKey: this.env.AT_API_KEY, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as {
        SMSMessageData?: { Recipients?: Array<{ status?: string; messageId?: string }> };
      };
      const recipient = json.SMSMessageData?.Recipients?.[0];
      const ok = res.ok && (recipient?.status === "Success" || recipient?.status === "Sent");
      await this.store.logMessage({
        direction: "out", channel: "sms", phone, body,
        status: ok ? "sent" : `failed:${recipient?.status ?? res.status}`,
        providerId: recipient?.messageId ?? null,
      });
      if (!ok) console.warn(`[sms] send to ${maskPhone(phone)} failed: ${recipient?.status ?? res.status}`);
      return { ok, id: recipient?.messageId ?? null };
    } catch (err) {
      console.warn(`[sms] send to ${maskPhone(phone)} errored:`, (err as Error).message);
      await this.store.logMessage({ direction: "out", channel: "sms", phone, body, status: "error", providerId: null });
      return { ok: false, id: null };
    }
  }

  async call(rawPhone: string, tag: string): Promise<{ ok: boolean }> {
    const phone = normalizePhone(rawPhone);
    const to = e164(phone);
    if (!to) return { ok: false };

    if (this.voiceMode === "mock") {
      this.push(phone, "call", tag);
      console.log(`[voice:mock] ringing ${maskPhone(phone)} (${tag})`);
      return { ok: true };
    }

    const form = new URLSearchParams({
      username: this.env.AT_USERNAME,
      from: this.env.AT_VOICE_NUMBER,
      to,
      clientRequestId: tag,
    });
    try {
      const res = await this.fetchImpl(this.voiceUrl(), {
        method: "POST",
        headers: { apiKey: this.env.AT_API_KEY, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as { entries?: Array<{ status?: string }>; errorMessage?: string };
      const ok = res.ok && json.entries?.[0]?.status === "Queued";
      if (!ok) console.warn(`[voice] call to ${maskPhone(phone)} failed: ${json.errorMessage ?? json.entries?.[0]?.status ?? res.status}`);
      return { ok };
    } catch (err) {
      console.warn(`[voice] call to ${maskPhone(phone)} errored:`, (err as Error).message);
      return { ok: false };
    }
  }

  outbox(phone: string | null, limit: number): OutboxItem[] {
    return this.mockOutbox.filter((m) => !phone || m.phone === phone).slice(-limit);
  }
}
