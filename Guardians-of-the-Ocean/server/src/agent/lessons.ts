/**
 * Micro-lessons sized for feature phones. `ussd` fits one USSD screen, `sms` fits one or two
 * SMS parts, `voice` is read aloud by the IVR. Keep claims general and defensible; the agent
 * (Aqua Ask) handles the cited, detailed answers.
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
    id: "mangroves",
    title: "Mangroves",
    keywords: ["mangrove", "mikoko", "roots", "erosion", "nursery"],
    ussd: "Mangroves: their roots trap mud and slow waves, so the shore washes away less. Young fish shelter between the roots.",
    sms: "Harmony lesson - Mangroves: their tangled roots trap mud and slow incoming waves, so the shore erodes less during storms. Young fish and crabs shelter between the roots, which helps local fishing. Mangrove forests line Africa's coasts from Senegal to Mozambique.",
    voice: "Today's lesson is about mangroves. Mangrove roots trap mud and slow down waves, so the shore washes away less during storms. Young fish and crabs hide between the roots, which keeps fishing healthy. Mangrove forests line Africa's coasts, from Senegal to Mozambique.",
    quiz: { q: "How do mangroves protect the shore?", options: ["Roots slow waves", "They make sand", "They block rain"], answer: 0, why: "Roots trap mud and slow waves." },
  },
  {
    id: "coral",
    title: "Coral reefs",
    keywords: ["coral", "reef", "bleach", "bleaching", "matumbawe"],
    ussd: "Coral reefs are alive. When the sea gets too warm, corals push out the algae that feed them and turn white. This is bleaching.",
    sms: "Harmony lesson - Coral reefs: corals are tiny animals that live with algae which give them food and colour. When the sea stays too warm, corals push the algae out and turn white. This is called bleaching. Reefs also break big waves before they reach the beach.",
    voice: "Today's lesson is about coral reefs. Corals are tiny animals that live together with algae. The algae give them food and colour. When the sea stays too warm, the corals push the algae out and turn white. This is called bleaching. Healthy reefs also break big waves before they reach the beach.",
    quiz: { q: "What makes coral bleach?", options: ["Too much rain", "Sea too warm", "Too many fish"], answer: 1, why: "Warm water makes corals expel their algae." },
  },
  {
    id: "plastic",
    title: "Plastic in the ocean",
    keywords: ["plastic", "waste", "trash", "litter", "taka", "bottle"],
    ussd: "Most ocean plastic starts on land and is carried by rivers and drains. It breaks into tiny pieces that fish and birds swallow.",
    sms: "Harmony lesson - Plastic: most plastic in the sea starts on land and is carried by rivers, drains and wind. Sunlight breaks it into tiny pieces called microplastics that fish and seabirds swallow. Keeping drains clear and collecting plastic before the rains stops it reaching the sea.",
    voice: "Today's lesson is about plastic. Most plastic in the sea starts on land. Rivers, drains and wind carry it to the ocean. Sunlight breaks it into tiny pieces called microplastics, and fish and seabirds swallow them. Collecting plastic before the rains stops it reaching the sea.",
    quiz: { q: "Where does most ocean plastic start?", options: ["On ships", "On land", "Under the sea"], answer: 1, why: "Rivers and drains carry it from land." },
  },
  {
    id: "clean-water",
    title: "Safe water and health",
    keywords: ["water", "drink", "boil", "cholera", "diarrhoea", "diarrhea", "maji", "health", "river"],
    ussd: "Dirty water spreads diseases like cholera. Boil drinking water for 1 minute, keep it covered, and wash hands with soap.",
    sms: "Harmony lesson - Safe water: water that looks clear can still carry germs that cause cholera and diarrhoea. Bring drinking water to a rolling boil for 1 minute, let it cool covered, and store it in a clean closed container. Wash hands with soap after the toilet and before eating.",
    voice: "Today's lesson is about safe water. Water can look clear and still carry germs that cause cholera and diarrhoea. Boil drinking water for one full minute, let it cool with a cover on, and keep it in a clean closed container. Always wash your hands with soap after the toilet and before eating.",
    quiz: { q: "How long should you boil drinking water?", options: ["1 minute", "5 seconds", "Until warm"], answer: 0, why: "A rolling boil for 1 minute kills most germs." },
  },
  {
    id: "one-health",
    title: "One Health",
    keywords: ["one health", "animals", "people", "environment", "disease"],
    ussd: "One Health: the health of people, animals and the environment is linked. A polluted river can make livestock and families sick.",
    sms: "Harmony lesson - One Health: people, animals and nature share the same water and land, so their health is linked. Sewage or waste in a river can make livestock sick and then spread to families. Protecting rivers and wetlands protects everyone downstream.",
    voice: "Today's lesson is about One Health. People, animals and nature share the same water and land, so their health is connected. Waste in a river can make animals sick and then spread to families. When we protect rivers and wetlands, we protect everyone who lives downstream.",
    quiz: { q: "One Health links people, animals and...?", options: ["Money", "Environment", "Phones"], answer: 1, why: "People, animals and the environment share health." },
  },
  {
    id: "floods",
    title: "Floods and storm surge",
    keywords: ["flood", "surge", "storm", "sea level", "mafuriko", "rain"],
    ussd: "Storm surge is sea water pushed onto land by strong winds. Wetlands, mangroves and dunes soak up the energy and protect homes.",
    sms: "Harmony lesson - Floods: a storm surge is sea water pushed onto land by strong winds. Rising seas make surges reach further inland. Mangroves, wetlands and sand dunes absorb wave energy and floodwater, so protecting them protects homes and farms.",
    voice: "Today's lesson is about floods. A storm surge is sea water pushed onto the land by strong winds. As the sea rises, surges reach further inland. Mangroves, wetlands and sand dunes soak up the energy of the waves, so protecting them protects homes and farms.",
    quiz: { q: "What absorbs storm surge energy?", options: ["Concrete roads", "Wetlands", "Street lights"], answer: 1, why: "Wetlands, mangroves and dunes absorb wave energy." },
  },
  {
    id: "seagrass",
    title: "Seagrass",
    keywords: ["seagrass", "dugong", "turtle", "carbon", "nyasi"],
    ussd: "Seagrass meadows grow in shallow water. They feed turtles and dugongs, keep water clear and store carbon in the seabed.",
    sms: "Harmony lesson - Seagrass: seagrass meadows grow in shallow, clear coastal water. They feed sea turtles and dugongs, shelter young fish, hold sand in place and store carbon in the seabed. Boat anchors and dirty runoff are among the things that damage them.",
    voice: "Today's lesson is about seagrass. Seagrass meadows grow in shallow coastal water. They feed sea turtles and dugongs, give young fish a place to hide, hold sand in place, and store carbon in the seabed. Boat anchors and dirty water running off the land can damage them.",
    quiz: { q: "Which animal eats seagrass?", options: ["Shark", "Sea turtle", "Octopus"], answer: 1, why: "Green turtles and dugongs graze seagrass." },
  },
  {
    id: "action",
    title: "What you can do",
    keywords: ["help", "action", "volunteer", "cleanup", "plant", "saidia"],
    ussd: "You can help: join a beach clean-up, plant mangroves with your school, keep drains clear and teach one friend what you learned.",
    sms: "Harmony lesson - Take action: join a beach or river clean-up, plant mangroves with your school club, keep drains near home clear of plastic, and teach one friend what you learned this week. Reply QUIZ to test yourself or AGENT to talk to a person.",
    voice: "Today's lesson is about taking action. Join a beach or river clean-up. Plant mangroves with your school club. Keep the drains near your home free of plastic. And teach one friend what you learned this week.",
    quiz: { q: "Which action stops plastic reaching the sea?", options: ["Clear drains", "Burn tyres", "Buy more bags"], answer: 0, why: "Clear drains stop plastic washing to the sea." },
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
    const score = lesson.keywords.reduce((s, k) => (q.includes(k) ? s + k.length : s), 0);
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
