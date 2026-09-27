/** The rail that carried a payment. */
export type Provider = "mpesa" | "airtel" | "pawapay";
export type PaymentStatus = "pending" | "paid" | "failed" | "cancelled" | "timeout";
export type TicketStatus = "open" | "answered" | "handoff" | "closed";
export type Channel = "web" | "sms" | "ussd" | "voice";

export interface MobilePayment {
  id: string;
  provider: Provider;
  phone: string;
  country: string;
  wallet: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  purpose: string;
  channel: string;
  providerRef: string | null;
  merchantRef: string | null;
  receipt: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Student {
  id: string;
  phone: string;
  name: string | null;
  school: string | null;
  optedIn: boolean;
  lessonIndex: number;
  quizPending: number | null;
  points: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentTicket {
  id: string;
  phone: string;
  channel: string;
  question: string;
  answer: string | null;
  status: TicketStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageLog {
  id: string;
  direction: "in" | "out";
  channel: string;
  phone: string;
  body: string;
  status: string;
  providerId: string | null;
  createdAt: Date;
}

export type NewPayment = Pick<MobilePayment, "provider" | "phone" | "country" | "wallet" | "amount" | "currency" | "purpose" | "channel">;
export type PaymentPatch = Partial<Pick<MobilePayment, "status" | "providerRef" | "merchantRef" | "receipt" | "failureReason">>;
export type StudentPatch = Partial<Pick<Student, "name" | "school" | "optedIn" | "lessonIndex" | "quizPending" | "points">>;
export type TicketPatch = Partial<Pick<AgentTicket, "answer" | "status">>;

export interface PaymentTotals {
  paidCount: number;
  pendingCount: number;
  countries: string[];
  /** Paid amounts per currency; gifts arrive in many currencies and are never summed across them. */
  byCurrency: Record<string, { amount: number; count: number }>;
}

export interface Store {
  readonly kind: "memory" | "postgres";

  createPayment(data: NewPayment): Promise<MobilePayment>;
  updatePayment(id: string, patch: PaymentPatch): Promise<MobilePayment | null>;
  /** Moves a payment out of `pending` exactly once. Returns null if it was already settled. */
  settlePayment(id: string, patch: PaymentPatch): Promise<MobilePayment | null>;
  getPayment(id: string): Promise<MobilePayment | null>;
  findPaymentByRef(provider: Provider, providerRef: string): Promise<MobilePayment | null>;
  paymentsForPhone(phone: string, limit: number): Promise<MobilePayment[]>;
  listPending(createdBefore: Date, limit: number): Promise<MobilePayment[]>;
  paymentTotals(): Promise<PaymentTotals>;

  getStudent(phone: string): Promise<Student | null>;
  upsertStudent(phone: string, patch?: StudentPatch): Promise<Student>;
  listOptedIn(limit: number): Promise<Student[]>;
  studentCount(): Promise<number>;

  createTicket(data: Pick<AgentTicket, "phone" | "channel" | "question"> & Partial<Pick<AgentTicket, "answer" | "status">>): Promise<AgentTicket>;
  updateTicket(id: string, patch: TicketPatch): Promise<AgentTicket | null>;
  getTicket(id: string): Promise<AgentTicket | null>;
  listTickets(status: TicketStatus | "all", limit: number): Promise<AgentTicket[]>;

  logMessage(entry: Omit<MessageLog, "id" | "createdAt">): Promise<MessageLog>;
  listMessages(phone: string | null, limit: number): Promise<MessageLog[]>;

  close(): Promise<void>;
}
