/**
 * Health micro-lessons sized for feature phones. `ussd` fits one USSD screen, `sms` fits one or two
 * SMS parts, `voice` is read aloud by the IVR. Content is general public-health guidance (safe water,
 * hygiene, cholera, ORS, malaria, danger signs); it is not a diagnosis, and every lesson points to a
 * health facility or a Harmony health guide when someone is unwell. Have a clinician review changes.
 */

export interface Lesson {
  id: string;
  title: string;
  keywords: string[];
  ussd: string;
  sms: string;
  voice: string;
  quiz: { q: string; options: [string, string, string]; answer: 0 | 1 | 2; why: string };
}

export const LESSONS: Lesson[] = [
  {
    id: "safe-water",
    title: "Safe drinking water",
    keywords: ["water", "drink", "boil", "river", "well", "borehole", "maji", "typhoid"],
    ussd: "Clear water can still carry germs. Boil drinking water for 1 minute, let it cool covered, and keep it in a clean closed pot.",
    sms: "Harmony lesson - Safe water: water that looks clear can still carry germs that cause cholera, typhoid and diarrhoea. Bring drinking water to a rolling boil for 1 minute, let it cool covered, and store it in a clean closed container. If you can't boil, use water treatment tablets as directed.",
    voice: "Today's lesson is about safe drinking water. Water can look clear and still carry germs that cause cholera, typhoid and diarrhoea. Boil drinking water for one full minute, let it cool with a cover on, and keep it in a clean closed container. If you cannot boil water, use water treatment tablets as directed.",
    quiz: { q: "How long should you boil drinking water?", options: ["1 minute", "5 seconds", "Until warm"], answer: 0, why: "A rolling boil for 1 minute kills most germs." },
  },
  {
    id: "handwashing",
    title: "Handwashing",
    keywords: ["hand", "hands", "soap", "wash", "germs", "hygiene", "sabuni"],
    ussd: "Wash hands with soap and water for 20 seconds: after the toilet, before cooking and eating, and after caring for someone sick.",
    sms: "Harmony lesson - Handwashing: soap and water remove the germs that spread diarrhoea, cholera and flu. Scrub palms, backs, between fingers and under nails for 20 seconds, then rinse. Key times: after the toilet, before cooking or eating, after changing a nappy, and after caring for someone sick.",
    voice: "Today's lesson is about handwashing. Soap and water remove the germs that spread diarrhoea, cholera and flu. Scrub your palms, the backs of your hands, between your fingers and under your nails for twenty seconds, then rinse. Always wash after the toilet, before cooking or eating, and after caring for someone who is sick.",
    quiz: { q: "When must you wash hands with soap?", options: ["After the toilet", "Only on Sundays", "Only if dirty"], answer: 0, why: "After the toilet is one of the key times." },
  },
  {
    id: "cholera",
    title: "Cholera",
    keywords: ["cholera", "diarrhoea", "diarrhea", "vomit", "vomiting", "kipindupindu", "outbreak"],
    ussd: "Cholera causes sudden watery diarrhoea and vomiting. Start ORS at once and go to a health facility quickly. It can kill in hours.",
    sms: "Harmony lesson - Cholera: sudden, heavy watery diarrhoea (like rice water) with vomiting can be cholera. It spreads through dirty water and food and can kill within hours from dehydration. Start drinking ORS immediately and go to the nearest health facility. Treatment works when it starts early.",
    voice: "Today's lesson is about cholera. Sudden, heavy, watery diarrhoea with vomiting can be cholera. It spreads through dirty water and food, and it can kill within hours from dehydration. Start drinking oral rehydration solution straight away and go to the nearest health facility. Treatment works best when it starts early.",
    quiz: { q: "First step for sudden watery diarrhoea?", options: ["Start ORS", "Stop drinking", "Wait a week"], answer: 0, why: "ORS replaces lost fluids; then get to a clinic." },
  },
  {
    id: "ors",
    title: "ORS at home",
    keywords: ["ors", "rehydration", "dehydration", "salt", "sugar", "zinc"],
    ussd: "No ORS packet? Mix 1 litre safe water, 6 level teaspoons sugar and half a teaspoon salt. Sip often and see a health worker.",
    sms: "Harmony lesson - ORS at home: ORS replaces the water and salts lost in diarrhoea. Best: a ready ORS packet mixed as printed. If you have none, mix 1 litre of safe water with 6 level teaspoons of sugar and half a level teaspoon of salt. Give small sips often. Children also need zinc from a health worker.",
    voice: "Today's lesson is about oral rehydration solution, or O R S. It replaces the water and salts lost in diarrhoea. The best is a ready O R S packet, mixed as printed. If you have none, mix one litre of safe water with six level teaspoons of sugar and half a level teaspoon of salt. Give small sips often, and see a health worker. Children also need zinc.",
    quiz: { q: "Homemade ORS: 1 litre of water plus...?", options: ["6 sugar + half salt", "1 cup of salt", "Only sugar"], answer: 0, why: "6 level tsp sugar and half a level tsp salt." },
  },
  {
    id: "malaria",
    title: "Malaria",
    keywords: ["malaria", "mosquito", "net", "fever", "homa"],
    ussd: "Malaria spreads through mosquito bites at night. Sleep under a treated net every night. Fever? Test at a clinic within 1 day.",
    sms: "Harmony lesson - Malaria: mosquitoes that bite at night spread malaria. Sleep under an insecticide-treated net every night, especially children and pregnant women. Any fever in a malaria area needs a test at a health facility within 24 hours - early treatment saves lives.",
    voice: "Today's lesson is about malaria. Mosquitoes that bite at night spread malaria. Sleep under an insecticide-treated net every night, especially children and pregnant women, and clear standing water near your home. Any fever in a malaria area needs a test at a health facility within twenty four hours. Early treatment saves lives.",
    quiz: { q: "Best way to prevent malaria at night?", options: ["Treated bed net", "Open windows", "Cold shower"], answer: 0, why: "Insecticide-treated nets stop night bites." },
  },
  {
    id: "food-safety",
    title: "Food safety",
    keywords: ["food", "cook", "eat", "flies", "vegetables", "fruit", "chakula"],
    ussd: "Keep food safe: cook it well, eat it hot, cover it from flies, and wash fruit and vegetables with safe water.",
    sms: "Harmony lesson - Food safety: germs grow fast in food left warm. Cook meat and eggs well, eat food while hot, cover it from flies, and wash fruit and vegetables with safe water. Keep raw and cooked food apart, and wash hands before handling food.",
    voice: "Today's lesson is about food safety. Germs grow fast in food that is left warm. Cook meat and eggs well, eat food while it is hot, cover it from flies, and wash fruit and vegetables with safe water. Keep raw and cooked food apart, and wash your hands before handling food.",
    quiz: { q: "How should cooked food be kept?", options: ["Covered from flies", "Open in the sun", "On the floor"], answer: 0, why: "Flies carry germs onto uncovered food." },
  },
  {
    id: "one-health",
    title: "One Health",
    keywords: ["one health", "animals", "livestock", "environment", "sewage", "pollution"],
    ussd: "One Health: the health of people, animals and the environment is linked. A polluted river can make livestock and families sick.",
    sms: "Harmony lesson - One Health: people, animals and nature share the same water and land, so their health is linked. Sewage or waste in a river can make livestock sick and then spread to families. Protecting rivers and wells protects everyone downstream.",
    voice: "Today's lesson is about One Health. People, animals and nature share the same water and land, so their health is connected. Waste in a river can make animals sick and then spread to families. When we protect rivers and wells, we protect everyone who lives downstream.",
    quiz: { q: "One Health links people, animals and...?", options: ["Money", "Environment", "Phones"], answer: 1, why: "People, animals and the environment share health." },
  },
  {
    id: "danger-signs",
    title: "Danger signs",
    keywords: ["danger", "emergency", "clinic", "hospital", "sick", "baby", "child", "breathing", "fits"],
    ussd: "Go to a health facility now if someone can't drink, vomits everything, is very sleepy, has fits, or a young baby has fever.",
    sms: "Harmony lesson - Danger signs: go to a health facility now if someone cannot drink or breastfeed, vomits everything, is very sleepy or hard to wake, has fits, has blood in their stool, or breathes very fast. A baby under 2 months with fever also needs care now. Reply AGENT for a health guide.",
    voice: "Today's lesson is about danger signs. Go to a health facility straight away if someone cannot drink or breastfeed, vomits everything, is very sleepy or hard to wake, has fits, has blood in their stool, or is breathing very fast. A baby under two months with a fever also needs care now.",
    quiz: { q: "Which sign needs care right now?", options: ["Cannot drink", "Mild cough", "Tired after work"], answer: 0, why: "Not being able to drink is a danger sign." },
  },
];

export function lessonAt(index: number): Lesson {
  const n = LESSONS.length;
  return LESSONS[((index % n) + n) % n];
}

/** Best keyword match for a free-text question, or null. Used when the RAG service is unreachable. */
export function matchLesson(question: string): Lesson | null {
  const q = question.toLowerCase();
  let best: { lesson: Lesson; score: number } | null = null;
  for (const lesson of LESSONS) {
    const score = lesson.keywords.reduce((s, k) => (new RegExp(`\\b${k}`).test(q) ? s + k.length : s), 0);
    if (score > 0 && (!best || score > best.score)) best = { lesson, score };
  }
  return best?.lesson ?? null;
}

export const LETTERS = ["A", "B", "C"] as const;

export function quizText(lesson: Lesson, style: "sms" | "ussd"): string {
  if (style === "ussd") {
    return `${lesson.quiz.q}\n${lesson.quiz.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
  }
  return `Quiz: ${lesson.quiz.q} ${lesson.quiz.options.map((o, i) => `${LETTERS[i]}) ${o}`).join(" ")}. Reply A, B or C.`;
}

/** Words that mean "this may be an emergency": the agent leads with "go to a facility now". */
export const EMERGENCY = /\b(emergency|unconscious|not breathing|can'?t breathe|cannot breathe|seizure|fits|convulsion|heavy bleeding|bleeding a lot|snake ?bite|poison|chest pain|stroke)\b/i;
