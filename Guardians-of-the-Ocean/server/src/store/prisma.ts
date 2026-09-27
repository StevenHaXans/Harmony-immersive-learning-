import type { PrismaClient } from "@prisma/client";
import type {
  AgentTicket, MessageLog, MobilePayment, NewPayment, PaymentPatch, PaymentTotals,
  Provider, Store, Student, StudentPatch, TicketPatch, TicketStatus,
} from "./types.js";

export class PrismaStore implements Store {
  readonly kind = "postgres" as const;

  constructor(private db: PrismaClient) {}

  async createPayment(data: NewPayment): Promise<MobilePayment> {
    return (await this.db.mobilePayment.create({ data })) as MobilePayment;
  }

  async updatePayment(id: string, patch: PaymentPatch): Promise<MobilePayment | null> {
    try {
      return (await this.db.mobilePayment.update({ where: { id }, data: patch })) as MobilePayment;
    } catch {
      return null;
    }
  }

  async settlePayment(id: string, patch: PaymentPatch): Promise<MobilePayment | null> {
    // Conditional update: a callback and a status poll can race; only one of them wins.
    const res = await this.db.mobilePayment.updateMany({ where: { id, status: "pending" }, data: patch });
    if (res.count === 0) return null;
    return this.getPayment(id);
  }

  async getPayment(id: string): Promise<MobilePayment | null> {
    return (await this.db.mobilePayment.findUnique({ where: { id } })) as MobilePayment | null;
  }

  async findPaymentByRef(provider: Provider, providerRef: string): Promise<MobilePayment | null> {
    return (await this.db.mobilePayment.findUnique({
      where: { provider_providerRef: { provider, providerRef } },
    })) as MobilePayment | null;
  }

  async paymentsForPhone(phone: string, limit: number): Promise<MobilePayment[]> {
    return (await this.db.mobilePayment.findMany({
      where: { phone },
      orderBy: { createdAt: "desc" },
      take: limit,
    })) as MobilePayment[];
  }

  async listPending(createdBefore: Date, limit: number): Promise<MobilePayment[]> {
    return (await this.db.mobilePayment.findMany({
      where: { status: "pending", createdAt: { lt: createdBefore } },
      orderBy: { createdAt: "asc" },
      take: limit,
    })) as MobilePayment[];
  }

  async paymentTotals(): Promise<PaymentTotals> {
    const [byCurrency, byCountry, pendingCount] = await Promise.all([
      this.db.mobilePayment.groupBy({ by: ["currency"], where: { status: "paid" }, _sum: { amount: true }, _count: true }),
      this.db.mobilePayment.groupBy({ by: ["country"], where: { status: "paid" } }),
      this.db.mobilePayment.count({ where: { status: "pending" } }),
    ]);
    const totals: PaymentTotals = { paidCount: 0, pendingCount, countries: byCountry.map((r) => r.country).sort(), byCurrency: {} };
    for (const row of byCurrency) {
      totals.byCurrency[row.currency] = { amount: row._sum.amount ?? 0, count: row._count };
      totals.paidCount += row._count;
    }
    return totals;
  }

  async getStudent(phone: string): Promise<Student | null> {
    return this.db.student.findUnique({ where: { phone } });
  }

  async upsertStudent(phone: string, patch: StudentPatch = {}): Promise<Student> {
    return this.db.student.upsert({ where: { phone }, update: patch, create: { phone, ...patch } });
  }

  async listOptedIn(limit: number): Promise<Student[]> {
    return this.db.student.findMany({ where: { optedIn: true }, take: limit, orderBy: { createdAt: "asc" } });
  }

  async studentCount(): Promise<number> {
    return this.db.student.count();
  }

  async createTicket(data: Pick<AgentTicket, "phone" | "channel" | "question"> & Partial<Pick<AgentTicket, "answer" | "status">>): Promise<AgentTicket> {
    return (await this.db.agentTicket.create({ data })) as AgentTicket;
  }

  async updateTicket(id: string, patch: TicketPatch): Promise<AgentTicket | null> {
    try {
      return (await this.db.agentTicket.update({ where: { id }, data: patch })) as AgentTicket;
    } catch {
      return null;
    }
  }

  async getTicket(id: string): Promise<AgentTicket | null> {
    return (await this.db.agentTicket.findUnique({ where: { id } })) as AgentTicket | null;
  }

  async listTickets(status: TicketStatus | "all", limit: number): Promise<AgentTicket[]> {
    return (await this.db.agentTicket.findMany({
      where: status === "all" ? {} : { status },
      orderBy: { createdAt: "desc" },
      take: limit,
    })) as AgentTicket[];
  }

  async logMessage(entry: Omit<MessageLog, "id" | "createdAt">): Promise<MessageLog> {
    return (await this.db.messageLog.create({ data: entry })) as MessageLog;
  }

  async listMessages(phone: string | null, limit: number): Promise<MessageLog[]> {
    const rows = await this.db.messageLog.findMany({
      where: phone ? { phone } : {},
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return (rows as MessageLog[]).reverse();
  }

  async close(): Promise<void> {
    await this.db.$disconnect();
  }
}
