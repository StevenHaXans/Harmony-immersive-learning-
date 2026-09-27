-- CreateEnum
CREATE TYPE "MobileProvider" AS ENUM ('mpesa', 'airtel', 'pawapay');

-- CreateEnum
CREATE TYPE "MobilePaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'cancelled', 'timeout');

-- CreateEnum
CREATE TYPE "AgentTicketStatus" AS ENUM ('open', 'answered', 'handoff', 'closed');

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "school" TEXT,
    "opted_in" BOOLEAN NOT NULL DEFAULT false,
    "lesson_index" INTEGER NOT NULL DEFAULT 0,
    "quiz_pending" INTEGER,
    "points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_payments" (
    "id" TEXT NOT NULL,
    "provider" "MobileProvider" NOT NULL,
    "phone" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'KE',
    "wallet" TEXT NOT NULL DEFAULT 'mpesa',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "status" "MobilePaymentStatus" NOT NULL DEFAULT 'pending',
    "purpose" TEXT NOT NULL DEFAULT 'restoration',
    "channel" TEXT NOT NULL DEFAULT 'web',
    "provider_ref" TEXT,
    "merchant_ref" TEXT,
    "receipt" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tickets" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" "AgentTicketStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "provider_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "students_phone_key" ON "students"("phone");

-- CreateIndex
CREATE INDEX "students_opted_in_idx" ON "students"("opted_in");

-- CreateIndex
CREATE INDEX "mobile_payments_phone_idx" ON "mobile_payments"("phone");

-- CreateIndex
CREATE INDEX "mobile_payments_status_idx" ON "mobile_payments"("status");

-- CreateIndex
CREATE INDEX "mobile_payments_country_idx" ON "mobile_payments"("country");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_payments_provider_provider_ref_key" ON "mobile_payments"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "agent_tickets_status_idx" ON "agent_tickets"("status");

-- CreateIndex
CREATE INDEX "agent_tickets_phone_idx" ON "agent_tickets"("phone");

-- CreateIndex
CREATE INDEX "message_logs_phone_idx" ON "message_logs"("phone");

