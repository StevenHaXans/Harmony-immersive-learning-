import type { Env } from "../env.js";
import { e164, maskPhone, normalizePhone } from "../lib/phone.js";
import { forSms } from "../lib/text.js";
import type { Store } from "../store/types.js";
import type { Messenger, OutboxItem } from "./africastalking.js";

/**
 * Click Mobile: the fallback SMS gateway. When Africa's Talking cannot deliver a message (an outage
 * or a rejected route), Harmony sends it again through Click Mobile.
 *
 * Click Mobile has no public API reference yet. The request below (JSON { to, message, sender } with
 * a Bearer key, POSTed to CLICKMOBILE_SMS_URL) is a placeholder to confirm once they issue API
 * access; only `send` should need to change.
 */
export class ClickMobile {
  constructor(private env: Env, private store: Store, private fetchImpl: typeof fetch = fetch) {}

  get ready(): boolean {
    return !!(this.env.CLICKMOBILE_SMS_URL && this.env.CLICKMOBILE_API_KEY);
  }

  async send(rawPhone: string, message: string): Promise<{ ok: boolean; id: string | null }> {
    const body = forSms(message);
    const phone = normalizePhone(rawPhone);
    const to = e164(phone);
    if (!this.ready || !to || !body) return { ok: false, id: null };
    try {
      const res = await this.fetchImpl(this.env.CLICKMOBILE_SMS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.env.CLICKMOBILE_API_KEY}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ to, message: body, sender: this.env.CLICKMOBILE_SENDER || undefined }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
      const id = json.messageId ?? json.id ?? null;
      await this.store.logMessage({
        direction: "out", channel: "sms", phone, body,
        status: res.ok ? "sent:clickmobile" : `failed:clickmobile:${res.status}`,
        providerId: id,
      });
      if (!res.ok) console.warn(`[sms] Click Mobile send to ${maskPhone(phone)} failed: ${res.status}`);
      return { ok: res.ok, id };
    } catch (err) {
      console.warn(`[sms] Click Mobile send to ${maskPhone(phone)} errored:`, (err as Error).message);
      await this.store.logMessage({ direction: "out", channel: "sms", phone, body, status: "error:clickmobile", providerId: null });
      return { ok: false, id: null };
    }
  }
}

/** Sends through the primary gateway and retries a failed SMS through the fallback. Calls stay on the primary. */
export class WithSmsFallback implements Messenger {
  constructor(private primary: Messenger, private fallback: ClickMobile) {}

  get smsMode() {
    return this.primary.smsMode;
  }

  get voiceMode() {
    return this.primary.voiceMode;
  }

  async sendSms(phone: string, message: string): Promise<{ ok: boolean; id: string | null }> {
    const first = await this.primary.sendSms(phone, message);
    if (first.ok || this.primary.smsMode === "mock" || !this.fallback.ready) return first;
    console.warn(`[sms] retrying ${maskPhone(normalizePhone(phone))} through Click Mobile`);
    return this.fallback.send(phone, message);
  }

  call(phone: string, tag: string): Promise<{ ok: boolean }> {
    return this.primary.call(phone, tag);
  }

  outbox(phone: string | null, limit: number): OutboxItem[] {
    return this.primary.outbox(phone, limit);
  }
}
