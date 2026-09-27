import type { Env } from "../env.js";
import type { Messenger } from "../comms/africastalking.js";
import { maskPhone, normalizePhone, prettyPhone } from "../lib/phone.js";
import { fitTo, toGsm7 } from "../lib/text.js";
import type { AgentTicket, Channel, Store } from "../store/types.js";

/**
 * Human help desk for feature phones. A student asks for a person from USSD, SMS, voice or the
 * web. Guides get an SMS and can answer by SMS ("R <code> <message>") or from the agent
 * console; if voice is set up the student also gets a free callback that rings a guide.
 */

export function ticketCode(ticket: Pick<AgentTicket, "id">): string {
  return ticket.id.replace(/[^a-z0-9]/gi, "").slice(-5).toUpperCase();
}

export class Desk {
  constructor(private env: Env, private store: Store, private messenger: Messenger) {}

  get hasGuides(): boolean {
    return this.env.agentPhones.length > 0;
  }

  async requestHuman(phone: string, channel: Channel, question: string, opts: { call?: boolean } = {}): Promise<{ ticket: AgentTicket; calling: boolean }> {
    const q = toGsm7(question).slice(0, 300) || "(asked to speak to a person)";
    const ticket = await this.store.createTicket({ phone, channel, question: q, status: "handoff" });
    const code = ticketCode(ticket);

    const alert = fitTo(`Harmony help ${code}: ${prettyPhone(phone)} via ${channel.toUpperCase()}: "${q}". Reply R ${code} <message> to answer by SMS.`, 459);
    for (const guide of this.env.agentPhones) await this.messenger.sendSms(guide, alert);

    // A real callback needs guides to bridge to; in practice mode the simulator shows the call.
    const canCall = this.messenger.voiceMode === "mock" || this.hasGuides;
    const calling = opts.call !== false && canCall && (await this.messenger.call(phone, `agent:${ticket.id}`)).ok;

    await this.messenger.sendSms(
      phone,
      calling
        ? `Harmony: a health guide will call you shortly on this number. The call is free. Your ticket is ${code}.`
        : `Harmony: a health guide has your question and will reply by SMS soon. Your ticket is ${code}.`
    );
    console.log(`[desk] ticket ${code} from ${maskPhone(phone)} via ${channel} (calling=${calling})`);
    return { ticket, calling };
  }

  /** Records an agent-answered question so guides can review what the AI told students. */
  async logAnswered(phone: string, channel: Channel, question: string, answer: string): Promise<void> {
    await this.store.createTicket({ phone, channel, question: toGsm7(question).slice(0, 300), answer, status: "answered" });
  }

  async reply(ticketId: string, message: string, by: string): Promise<AgentTicket | null> {
    const ticket = await this.store.getTicket(ticketId);
    if (!ticket) return null;
    const text = toGsm7(message).trim();
    if (!text) return null;
    await this.messenger.sendSms(ticket.phone, `Harmony health guide: ${text}`);
    const updated = await this.store.updateTicket(ticket.id, { answer: text, status: "answered" });
    console.log(`[desk] ${ticketCode(ticket)} answered by ${by}`);
    return updated;
  }

  async findByCode(code: string): Promise<AgentTicket | null> {
    const wanted = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(wanted)) return null;
    const recent = await this.store.listTickets("all", 500);
    return recent.find((t) => ticketCode(t) === wanted) ?? null;
  }

  isGuide(phone: string): boolean {
    const n = normalizePhone(phone);
    return !!n && this.env.agentPhones.some((g) => normalizePhone(g) === n);
  }

  /** "R AB12C The answer..." sent by a guide from their own phone. */
  async handleGuideSms(from: string, text: string): Promise<string> {
    const m = /^\s*(?:R|REPLY)\s+([A-Z0-9]{5})\s+([\s\S]+)$/i.exec(text);
    if (!m) return "Harmony desk: reply with R <code> <message>, e.g. R AB12C Boil water for 1 minute.";
    const ticket = await this.findByCode(m[1]);
    if (!ticket) return `Harmony desk: no ticket ${m[1].toUpperCase()}.`;
    await this.reply(ticket.id, m[2], maskPhone(from));
    return `Harmony desk: sent to ${maskPhone(ticket.phone)} (${ticketCode(ticket)}).`;
  }
}
