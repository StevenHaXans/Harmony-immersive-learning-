import { LESSONS, LETTERS, lessonAt, quizText } from "../agent/lessons.js";
import type { Deps } from "../deps.js";
import { money, walletFromWord } from "../lib/countries.js";
import { countryOf, normalizePhone } from "../lib/phone.js";
import { SMS_MAX } from "../lib/text.js";
import { walletLabel } from "../payments/service.js";
import { givenLabel } from "./ussd.js";

/**
 * Two-way SMS on the shortcode. The first word is the command (English or Kiswahili);
 * anything else is treated as a question for the agent. Returns the reply to send, or null.
 */

export function helpText(deps: Deps): string {
  return `Harmony Health SMS: LESSON - next tip. QUIZ - test yourself. ASK <question>. AGENT - talk to a health guide. PAY <amount> - support community health. POINTS. STOP to quit. Or dial ${deps.env.USSD_CODE}.`;
}

export async function handleSms(deps: Deps, rawFrom: string, rawText: string): Promise<string | null> {
  const phone = normalizePhone(rawFrom);
  if (!phone) return null;
  const text = String(rawText ?? "").trim();
  await deps.store.logMessage({ direction: "in", channel: "sms", phone, body: text.slice(0, 500), status: "received", providerId: null });

  // Guides answer tickets from their own phones.
  if (deps.desk.isGuide(phone) && /^\s*(R|REPLY)\s/i.test(text)) {
    return deps.desk.handleGuideSms(phone, text);
  }

  const [first = "", ...restWords] = text.split(/\s+/);
  const word = first.toUpperCase().replace(/[^A-Z]/g, "");
  const rest = restWords.join(" ").trim();
  const student = await deps.store.upsertStudent(phone);

  // A bare A/B/C (or 1/2/3) answers the open quiz.
  if (student.quizPending != null && /^[ABC123]$/i.test(text)) {
    const lesson = lessonAt(student.quizPending);
    const pick = /^[123]$/.test(text) ? Number(text) - 1 : LETTERS.indexOf(text.toUpperCase() as "A");
    const correct = pick === lesson.quiz.answer;
    const updated = await deps.store.upsertStudent(phone, {
      quizPending: null,
      points: correct ? student.points + 10 : student.points,
    });
    return correct
      ? `Correct! +10 points (total ${updated.points}). ${lesson.quiz.why} Reply LESSON for the next one.`
      : `Not quite - the answer is ${LETTERS[lesson.quiz.answer]}) ${lesson.quiz.options[lesson.quiz.answer]}. ${lesson.quiz.why} Reply LESSON to keep going.`;
  }

  switch (word) {
    case "JOIN":
    case "START":
    case "ANZA": {
      const name = rest.slice(0, 40) || student.name;
      const updated = await deps.store.upsertStudent(phone, { optedIn: true, name: name || null });
      const lesson = lessonAt(updated.lessonIndex);
      await deps.store.upsertStudent(phone, { lessonIndex: updated.lessonIndex + 1 });
      return `Welcome${name ? " " + name : ""}! You'll get one short health tip a day. ${lesson.sms.replace(/^Harmony lesson - /, "First tip - ")} Reply HELP for commands.`;
    }

    case "STOP":
    case "ACHA":
    case "UNSUBSCRIBE": {
      await deps.store.upsertStudent(phone, { optedIn: false, quizPending: null });
      return "You won't get daily Harmony health tips any more. Text JOIN to come back any time.";
    }

    case "LESSON":
    case "L":
    case "SOMO": {
      const lesson = lessonAt(student.lessonIndex);
      await deps.store.upsertStudent(phone, { lessonIndex: student.lessonIndex + 1 });
      return `${lesson.sms} Reply QUIZ to test yourself.`;
    }

    case "QUIZ":
    case "SWALI": {
      const index = Math.max(student.lessonIndex - 1, 0);
      await deps.store.upsertStudent(phone, { quizPending: index });
      return quizText(lessonAt(index), "sms");
    }

    case "POINTS":
    case "STATUS":
    case "ALAMA": {
      const payments = await deps.store.paymentsForPhone(phone, 50);
      return `Harmony progress: ${Math.min(student.lessonIndex, LESSONS.length)}/${LESSONS.length} tips, ${student.points} quiz points, support given: ${givenLabel(payments)}. Daily tips are ${student.optedIn ? "on" : "off"}.`;
    }

    case "AGENT":
    case "HUMAN":
    case "PERSON":
    case "MTU":
    case "MSAADA": {
      deps.background(() => deps.desk.requestHuman(phone, "sms", rest || "Asked to talk to a person", { call: !rest }));
      return null; // the desk confirms with the ticket number
    }

    case "PAY":
    case "CHANGIA":
    case "SUPPORT": {
      // "PAY 5000" or "PAY 5000 MTN": the wallet word is only needed where the network is unclear.
      const country = countryOf(phone)!;
      const words = rest.split(/\s+/).filter(Boolean);
      const amount = Number((words.find((w) => /^\d[\d,]*$/.test(w)) ?? "").replace(/,/g, ""));
      const walletWord = words.find((w) => !/^\d/.test(w));
      const wallet = walletWord ? walletFromWord(country, walletWord) : null;
      const example = `PAY ${country.amounts[1]}${country.wallets.length > 1 ? ` ${country.wallets[0].id.toUpperCase()}` : ""}`;
      if (!amount) return `Send PAY and an amount, e.g. ${example}. Min ${money(country.min, country.currency)}.`;
      if (walletWord && !wallet) return `Harmony: pick ${country.wallets.map((w) => w.id.toUpperCase()).join(" or ")}, e.g. ${example}.`;
      try {
        const { payment } = await deps.payments.start({ phone, amount, wallet: wallet?.id, channel: "sms" });
        return `Harmony: check your phone and enter your ${walletLabel(payment.country, payment.wallet)} PIN to give ${money(payment.amount, payment.currency)}.`;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.startsWith("Choose your mobile money")) {
          return `Harmony: which wallet? Reply ${country.wallets.map((w) => `PAY ${amount} ${w.id.toUpperCase()}`).join(" or ")}.`;
        }
        return `Harmony: ${msg}`;
      }
    }

    case "HELP":
    case "INFO":
      return helpText(deps);

    case "ASK":
    case "ULIZA":
      if (!rest) return "Send ASK and your question, e.g. ASK what are the signs of cholera?";
      return answer(deps, phone, rest);

    default:
      if (!text) return helpText(deps);
      return answer(deps, phone, text);
  }
}

async function answer(deps: Deps, phone: string, question: string): Promise<string> {
  const reply = await deps.agent.answer(question, SMS_MAX - 12);
  await deps.desk.logAnswered(phone, "sms", question, reply.text);
  return `Harmony: ${reply.text}`;
}
