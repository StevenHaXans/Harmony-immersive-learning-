import { randomUUID } from "node:crypto";
import type {
  AgentTicket, MessageLog, MobilePayment, NewPayment, PaymentPatch, PaymentTotals,
  Provider, Store, Student, StudentPatch, TicketPatch, TicketStatus,
} from "./types.js";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Dev / demo store. Everything is lost on restart. */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private payments = new Map<string, MobilePayment>();
  private students = new Map<string, Student>();
  private tickets = new Map<string, AgentTicket>();
  private messages: MessageLog[] = [];

  async createPayment(data: NewPayment): Promise<MobilePayment> {
    const now = new Date();
    const row: MobilePayment = {
      id: id("pay"),
      provider: data.provider,
      phone: data.phone,
      country: data.country,
      wallet: data.wallet,
      amount: data.amount,
      currency: data.currency,
      status: "pending",
      purpose: data.purpose,
      channel: data.channel,
      providerRef: null,
      merchantRef: null,
      receipt: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.payments.set(row.id, row);
    return { ...row };
  }

  async updatePayment(paymentId: string, patch: PaymentPatch): Promise<MobilePayment | null> {
    const row = this.payments.get(paymentId);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return { ...row };
  }

  async settlePayment(paymentId: string, patch: PaymentPatch): Promise<MobilePayment | null> {
    const row = this.payments.get(paymentId);
    if (!row || row.status !== "pending") return null;
    return this.updatePayment(paymentId, patch);
  }

  async getPayment(paymentId: string): Promise<MobilePayment | null> {
    const row = this.payments.get(paymentId);
    return row ? { ...row } : null;
  }

  async findPaymentByRef(provider: Provider, providerRef: string): Promise<MobilePayment | null> {
    for (const row of this.payments.values()) {
      if (row.provider === provider && row.providerRef === providerRef) return { ...row };
    }
    return null;
  }

  async paymentsForPhone(phone: string, limit: number): Promise<MobilePayment[]> {
    return [...this.payments.values()]
      .filter((p) => p.phone === phone)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((p) => ({ ...p }));
  }

  async listPending(createdBefore: Date, limit: number): Promise<MobilePayment[]> {
    return [...this.payments.values()]
      .filter((p) => p.status === "pending" && p.createdAt < createdBefore)
      .slice(0, limit)
      .map((p) => ({ ...p }));
  }

  async paymentTotals(): Promise<PaymentTotals> {
    const totals: PaymentTotals = { paidCount: 0, pendingCount: 0, countries: [], byCurrency: {} };
    const countries = new Set<string>();
    for (const p of this.payments.values()) {
      if (p.status === "paid") {
        totals.paidCount += 1;
        countries.add(p.country);
        const bucket = (totals.byCurrency[p.currency] ??= { amount: 0, count: 0 });
        bucket.amount += p.amount;
        bucket.count += 1;
      } else if (p.status === "pending") {
        totals.pendingCount += 1;
      }
    }
    totals.countries = [...countries].sort();
    return totals;
  }

  async getStudent(phone: string): Promise<Student | null> {
    const row = this.students.get(phone);
    return row ? { ...row } : null;
  }

  async upsertStudent(phone: string, patch: StudentPatch = {}): Promise<Student> {
    const now = new Date();
    const existing = this.students.get(phone);
    if (existing) {
      Object.assign(existing, stripUndefined(patch), { updatedAt: now });
      return { ...existing };
    }
    const row: Student = {
      id: id("stu"),
      phone,
      name: null,
      school: null,
      optedIn: false,
      lessonIndex: 0,
      quizPending: null,
      points: 0,
      createdAt: now,
      updatedAt: now,
      ...stripUndefined(patch),
    };
    this.students.set(phone, row);
    return { ...row };
  }

  async listOptedIn(limit: number): Promise<Student[]> {
    return [...this.students.values()].filter((s) => s.optedIn).slice(0, limit).map((s) => ({ ...s }));
  }

  async studentCount(): Promise<number> {
    return this.students.size;
  }

  async createTicket(data: Pick<AgentTicket, "phone" | "channel" | "question"> & Partial<Pick<AgentTicket, "answer" | "status">>): Promise<AgentTicket> {
    const now = new Date();
    const row: AgentTicket = {
      id: id("tkt"),
      phone: data.phone,
      channel: data.channel,
      question: data.question,
      answer: data.answer ?? null,
      status: data.status ?? "open",
      createdAt: now,
      updatedAt: now,
    };
    this.tickets.set(row.id, row);
    return { ...row };
  }

  async updateTicket(ticketId: string, patch: TicketPatch): Promise<AgentTicket | null> {
    const row = this.tickets.get(ticketId);
    if (!row) return null;
    Object.assign(row, stripUndefined(patch), { updatedAt: new Date() });
    return { ...row };
  }

  async getTicket(ticketId: string): Promise<AgentTicket | null> {
    const row = this.tickets.get(ticketId);
    return row ? { ...row } : null;
  }

  async listTickets(status: TicketStatus | "all", limit: number): Promise<AgentTicket[]> {
    return [...this.tickets.values()]
      .filter((t) => status === "all" || t.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }

  async logMessage(entry: Omit<MessageLog, "id" | "createdAt">): Promise<MessageLog> {
    const row: MessageLog = { ...entry, id: id("msg"), createdAt: new Date() };
    this.messages.push(row);
    if (this.messages.length > 2000) this.messages.splice(0, this.messages.length - 2000);
    return { ...row };
  }

  async listMessages(phone: string | null, limit: number): Promise<MessageLog[]> {
    return this.messages
      .filter((m) => !phone || m.phone === phone)
      .slice(-limit)
      .map((m) => ({ ...m }));
  }

  async close(): Promise<void> {}
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
