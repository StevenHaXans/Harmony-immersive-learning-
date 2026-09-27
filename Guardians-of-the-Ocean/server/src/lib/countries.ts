/**
 * Countries Harmony serves: dialling, number lengths, currency, networks and mobile-money
 * wallets. Wallet codes are pawaPay provider codes (https://docs.pawapay.io/v2/docs/providers),
 * which is the pan-African payments fallback; Kenya can also go direct (Daraja / Airtel).
 *
 * Network prefixes are only listed where they are well established. They drive hints in the UI
 * and the practice simulator; with live pawaPay the provider is predicted by pawaPay itself,
 * and anywhere a network is unknown the student simply picks their wallet.
 *
 * Wallets that need an OTP or a browser redirect (Orange Burkina, Wave) are left out because a
 * feature phone cannot complete them.
 */

export interface Network {
  id: string;
  name: string;
  /** Leading digits of the national significant number. */
  prefixes: string[];
  /** MCC+MNC codes, as sent by USSD gateways in `networkCode`. */
  mccmnc?: string[];
}

export interface Wallet {
  id: string;
  label: string;
  network: string;
  /** pawaPay provider code. */
  pawapay?: string;
  /** Direct integration available on this server. */
  direct?: "mpesa" | "airtel";
}

export interface Country {
  code: string;
  iso3: string;
  name: string;
  flag: string;
  dial: string;
  /** Valid lengths of the national significant number (without country code or trunk 0). */
  nsn: number[];
  /** Whether a leading 0 is a trunk prefix to drop. False where the 0 is part of the number. */
  trunk0: boolean;
  /** Mobile numbers must start with one of these (national number); omitted where not needed. */
  mobileStarts?: string[];
  currency: string;
  amounts: number[];
  min: number;
  max: number;
  networks: Network[];
  wallets: Wallet[];
}

function range(from: number, to: number, width = 3): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(String(i).padStart(width, "0"));
  return out;
}

const XOF_XAF = { amounts: [500, 1000, 2000, 5000, 10000], min: 100, max: 2_000_000 };

export const COUNTRIES: Country[] = [
  {
    code: "KE", iso3: "KEN", name: "Kenya", flag: "🇰🇪", dial: "254", nsn: [9], trunk0: true, mobileStarts: ["1", "7"],
    currency: "KES", amounts: [50, 100, 250, 500, 1000], min: 10, max: 150_000,
    networks: [
      {
        id: "safaricom", name: "Safaricom", mccmnc: ["63902"],
        prefixes: [...range(700, 729), ...range(740, 746), "748", ...range(757, 759), "768", "769", ...range(790, 799), ...range(110, 115)],
      },
      { id: "airtel", name: "Airtel", mccmnc: ["63903"], prefixes: [...range(730, 739), ...range(750, 756), "762", ...range(780, 789), ...range(100, 102)] },
      { id: "telkom", name: "Telkom", mccmnc: ["63907"], prefixes: range(770, 779) },
    ],
    wallets: [
      { id: "mpesa", label: "M-Pesa", network: "safaricom", pawapay: "MPESA_KEN", direct: "mpesa" },
      { id: "airtel", label: "Airtel Money", network: "airtel", direct: "airtel" },
    ],
  },
  {
    code: "UG", iso3: "UGA", name: "Uganda", flag: "🇺🇬", dial: "256", nsn: [9], trunk0: true,
    currency: "UGX", amounts: [1000, 2000, 5000, 10000, 20000], min: 500, max: 5_000_000,
    networks: [
      { id: "mtn", name: "MTN", mccmnc: ["64110"], prefixes: ["76", "77", "78"] },
      { id: "airtel", name: "Airtel", mccmnc: ["64101"], prefixes: ["70", "74", "75"] },
    ],
    wallets: [
      { id: "mtn", label: "MTN MoMo", network: "mtn", pawapay: "MTN_MOMO_UGA" },
      { id: "airtel", label: "Airtel Money", network: "airtel", pawapay: "AIRTEL_OAPI_UGA" },
    ],
  },
  {
    code: "TZ", iso3: "TZA", name: "Tanzania", flag: "🇹🇿", dial: "255", nsn: [9], trunk0: true,
    currency: "TZS", amounts: [1000, 2000, 5000, 10000, 20000], min: 500, max: 5_000_000,
    networks: [
      { id: "vodacom", name: "Vodacom", mccmnc: ["64004"], prefixes: ["74", "75", "76"] },
      { id: "airtel", name: "Airtel", mccmnc: ["64005"], prefixes: ["68", "69", "78"] },
      { id: "tigo", name: "Yas (Tigo)", mccmnc: ["64002"], prefixes: ["65", "67", "71", "77"] },
      { id: "halotel", name: "Halotel", mccmnc: ["64009"], prefixes: ["61", "62"] },
    ],
    wallets: [
      { id: "mpesa", label: "M-Pesa", network: "vodacom", pawapay: "VODACOM_TZA" },
      { id: "airtel", label: "Airtel Money", network: "airtel", pawapay: "AIRTEL_TZA" },
      { id: "tigo", label: "Mixx by Yas", network: "tigo", pawapay: "TIGO_TZA" },
      { id: "halopesa", label: "HaloPesa", network: "halotel", pawapay: "HALOTEL_TZA" },
    ],
  },
  {
    code: "RW", iso3: "RWA", name: "Rwanda", flag: "🇷🇼", dial: "250", nsn: [9], trunk0: true,
    currency: "RWF", amounts: [500, 1000, 2000, 5000, 10000], min: 100, max: 2_000_000,
    networks: [
      { id: "mtn", name: "MTN", prefixes: ["78", "79"] },
      { id: "airtel", name: "Airtel", prefixes: ["72", "73"] },
    ],
    wallets: [
      { id: "mtn", label: "MTN MoMo", network: "mtn", pawapay: "MTN_MOMO_RWA" },
      { id: "airtel", label: "Airtel Money", network: "airtel", pawapay: "AIRTEL_RWA" },
    ],
  },
  {
    code: "ET", iso3: "ETH", name: "Ethiopia", flag: "🇪🇹", dial: "251", nsn: [9], trunk0: true,
    currency: "ETB", amounts: [50, 100, 250, 500, 1000], min: 10, max: 100_000,
    networks: [
      { id: "safaricom", name: "Safaricom", prefixes: ["7"] },
      { id: "ethiotelecom", name: "Ethio Telecom", prefixes: ["9"] },
    ],
    wallets: [{ id: "mpesa", label: "M-Pesa", network: "safaricom", pawapay: "MPESA_ETH" }],
  },
  {
    code: "GH", iso3: "GHA", name: "Ghana", flag: "🇬🇭", dial: "233", nsn: [9], trunk0: true,
    currency: "GHS", amounts: [5, 10, 20, 50, 100], min: 1, max: 10_000,
    networks: [
      { id: "mtn", name: "MTN", mccmnc: ["62001"], prefixes: ["24", "25", "53", "54", "55", "59"] },
      { id: "telecel", name: "Telecel", mccmnc: ["62002"], prefixes: ["20", "50"] },
      { id: "airteltigo", name: "AirtelTigo", mccmnc: ["62003", "62006"], prefixes: ["26", "27", "56", "57"] },
    ],
    wallets: [
      { id: "mtn", label: "MTN MoMo", network: "mtn", pawapay: "MTN_MOMO_GHA" },
      { id: "telecel", label: "Telecel Cash", network: "telecel", pawapay: "VODAFONE_GHA" },
      { id: "airteltigo", label: "AT Money", network: "airteltigo", pawapay: "AIRTELTIGO_GHA" },
    ],
  },
  {
    code: "NG", iso3: "NGA", name: "Nigeria", flag: "🇳🇬", dial: "234", nsn: [10], trunk0: true,
    currency: "NGN", amounts: [500, 1000, 2000, 5000, 10000], min: 100, max: 5_000_000,
    networks: [
      { id: "mtn", name: "MTN", prefixes: ["703", "704", "706", "707", "803", "806", "810", "813", "814", "816", "903", "906", "913", "916"] },
      { id: "airtel", name: "Airtel", prefixes: ["701", "708", "802", "808", "812", "901", "902", "904", "907", "912"] },
    ],
    wallets: [
      { id: "mtn", label: "MTN MoMo", network: "mtn", pawapay: "MTN_MOMO_NGA" },
      { id: "airtel", label: "Airtel SmartCash", network: "airtel", pawapay: "AIRTEL_NGA" },
    ],
  },
  {
    code: "ZM", iso3: "ZMB", name: "Zambia", flag: "🇿🇲", dial: "260", nsn: [9], trunk0: true,
    currency: "ZMW", amounts: [10, 20, 50, 100, 200], min: 1, max: 50_000,
    networks: [
      { id: "mtn", name: "MTN", mccmnc: ["64502"], prefixes: ["96", "76"] },
      { id: "airtel", name: "Airtel", mccmnc: ["64501"], prefixes: ["97", "77"] },
      { id: "zamtel", name: "Zamtel", mccmnc: ["64503"], prefixes: ["95", "75"] },
    ],
    wallets: [
      { id: "mtn", label: "MTN MoMo", network: "mtn", pawapay: "MTN_MOMO_ZMB" },
      { id: "airtel", label: "Airtel Money", network: "airtel", pawapay: "AIRTEL_OAPI_ZMB" },
      { id: "zamtel", label: "Zamtel Kwacha", network: "zamtel", pawapay: "ZAMTEL_ZMB" },
    ],
  },
  {
    code: "MW", iso3: "MWI", name: "Malawi", flag: "🇲🇼", dial: "265", nsn: [9], trunk0: true,
    currency: "MWK", amounts: [500, 1000, 2000, 5000, 10000], min: 100, max: 5_000_000,
    networks: [
      { id: "airtel", name: "Airtel", mccmnc: ["65010"], prefixes: ["99"] },
      { id: "tnm", name: "TNM", mccmnc: ["65001"], prefixes: ["88"] },
    ],
    wallets: [
      { id: "airtel", label: "Airtel Money", network: "airtel", pawapay: "AIRTEL_MWI" },
      { id: "tnm", label: "TNM Mpamba", network: "tnm", pawapay: "TNM_MWI" },
    ],
  },
  {
    code: "MZ", iso3: "MOZ", name: "Mozambique", flag: "🇲🇿", dial: "258", nsn: [9], trunk0: false,
    currency: "MZN", amounts: [50, 100, 250, 500, 1000], min: 10, max: 100_000,
    networks: [
      { id: "vodacom", name: "Vodacom", prefixes: ["84", "85"] },
      { id: "movitel", name: "Movitel", prefixes: ["86", "87"] },
    ],
    wallets: [
      { id: "mpesa", label: "M-Pesa", network: "vodacom", pawapay: "VODACOM_MOZ" },
      { id: "emola", label: "e-Mola", network: "movitel", pawapay: "MOVITEL_MOZ" },
    ],
  },
  {
    code: "LS", iso3: "LSO", name: "Lesotho", flag: "🇱🇸", dial: "266", nsn: [8], trunk0: false,
    currency: "LSL", amounts: [10, 20, 50, 100, 200], min: 1, max: 20_000,
    networks: [{ id: "vodacom", name: "Vodacom", prefixes: ["5"] }],
    wallets: [{ id: "mpesa", label: "M-Pesa", network: "vodacom", pawapay: "MPESA_LSO" }],
  },
  {
    code: "CD", iso3: "COD", name: "DR Congo", flag: "🇨🇩", dial: "243", nsn: [9], trunk0: true,
    currency: "CDF", amounts: [1000, 2000, 5000, 10000, 20000], min: 500, max: 5_000_000,
    networks: [
      { id: "vodacom", name: "Vodacom", prefixes: ["81", "82", "83"] },
      { id: "airtel", name: "Airtel", prefixes: ["97", "98", "99"] },
      { id: "orange", name: "Orange", prefixes: ["84", "85", "89"] },
    ],
    wallets: [
      { id: "mpesa", label: "M-Pesa", network: "vodacom", pawapay: "VODACOM_MPESA_COD" },
      { id: "airtel", label: "Airtel Money", network: "airtel", pawapay: "AIRTEL_COD" },
      { id: "orange", label: "Orange Money", network: "orange", pawapay: "ORANGE_COD" },
    ],
  },
  {
    code: "CG", iso3: "COG", name: "Congo", flag: "🇨🇬", dial: "242", nsn: [9], trunk0: false,
    currency: "XAF", ...XOF_XAF,
    networks: [
      { id: "mtn", name: "MTN", prefixes: ["06"] },
      { id: "airtel", name: "Airtel", prefixes: ["05"] },
    ],
    wallets: [
      { id: "mtn", label: "MTN MoMo", network: "mtn", pawapay: "MTN_MOMO_COG" },
      { id: "airtel", label: "Airtel Money", network: "airtel", pawapay: "AIRTEL_COG" },
    ],
  },
  {
    code: "CM", iso3: "CMR", name: "Cameroon", flag: "🇨🇲", dial: "237", nsn: [9], trunk0: false,
    currency: "XAF", ...XOF_XAF,
    networks: [
      { id: "mtn", name: "MTN", prefixes: ["67", "650", "651", "652", "653", "654", "680", "681", "682", "683"] },
      { id: "orange", name: "Orange", prefixes: ["69", "655", "656", "657", "658", "659"] },
    ],
    wallets: [
      { id: "mtn", label: "MTN MoMo", network: "mtn", pawapay: "MTN_MOMO_CMR" },
      { id: "orange", label: "Orange Money", network: "orange", pawapay: "ORANGE_CMR" },
    ],
  },
  {
    code: "GA", iso3: "GAB", name: "Gabon", flag: "🇬🇦", dial: "241", nsn: [7, 8], trunk0: false,
    currency: "XAF", ...XOF_XAF,
    networks: [],
    wallets: [{ id: "airtel", label: "Airtel Money", network: "airtel", pawapay: "AIRTEL_GAB" }],
  },
  {
    code: "CI", iso3: "CIV", name: "Côte d'Ivoire", flag: "🇨🇮", dial: "225", nsn: [10], trunk0: false,
    currency: "XOF", ...XOF_XAF,
    networks: [
      { id: "moov", name: "Moov", prefixes: ["01"] },
      { id: "mtn", name: "MTN", prefixes: ["05"] },
      { id: "orange", name: "Orange", prefixes: ["07"] },
    ],
    wallets: [
      { id: "mtn", label: "MTN MoMo", network: "mtn", pawapay: "MTN_MOMO_CIV" },
      { id: "orange", label: "Orange Money", network: "orange", pawapay: "ORANGE_CIV" },
    ],
  },
  {
    code: "SN", iso3: "SEN", name: "Senegal", flag: "🇸🇳", dial: "221", nsn: [9], trunk0: false,
    currency: "XOF", ...XOF_XAF,
    networks: [
      { id: "orange", name: "Orange", prefixes: ["77", "78"] },
      { id: "free", name: "Free", prefixes: ["76"] },
    ],
    wallets: [
      { id: "orange", label: "Orange Money", network: "orange", pawapay: "ORANGE_SEN" },
      { id: "free", label: "Free Money", network: "free", pawapay: "FREE_SEN" },
    ],
  },
  {
    code: "BJ", iso3: "BEN", name: "Benin", flag: "🇧🇯", dial: "229", nsn: [10], trunk0: false,
    currency: "XOF", ...XOF_XAF,
    networks: [],
    wallets: [
      { id: "mtn", label: "MTN MoMo", network: "mtn", pawapay: "MTN_MOMO_BEN" },
      { id: "moov", label: "Moov Money", network: "moov", pawapay: "MOOV_BEN" },
    ],
  },
  {
    code: "BF", iso3: "BFA", name: "Burkina Faso", flag: "🇧🇫", dial: "226", nsn: [8], trunk0: false,
    currency: "XOF", ...XOF_XAF,
    networks: [],
    wallets: [{ id: "moov", label: "Moov Money", network: "moov", pawapay: "MOOV_BFA" }],
  },
  {
    code: "SL", iso3: "SLE", name: "Sierra Leone", flag: "🇸🇱", dial: "232", nsn: [8], trunk0: true,
    currency: "SLE", amounts: [10, 20, 50, 100, 200], min: 1, max: 20_000,
    networks: [],
    wallets: [{ id: "orange", label: "Orange Money", network: "orange", pawapay: "ORANGE_SLE" }],
  },
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
const BY_ISO3 = new Map(COUNTRIES.map((c) => [c.iso3, c]));
// Longest dial codes first so "2560..." never matches a shorter code by accident.
const BY_DIAL = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

export function countryByCode(code: string | null | undefined): Country | null {
  return BY_CODE.get(String(code ?? "").toUpperCase()) ?? null;
}

export function countryByIso3(iso3: string | null | undefined): Country | null {
  return BY_ISO3.get(String(iso3 ?? "").toUpperCase()) ?? null;
}

/** Country of an already-normalised international number (digits, no plus). */
export function countryOfDigits(digits: string): Country | null {
  for (const c of BY_DIAL) {
    if (!digits.startsWith(c.dial) || !c.nsn.includes(digits.length - c.dial.length)) continue;
    const nsn = digits.slice(c.dial.length);
    if (!c.mobileStarts || c.mobileStarts.some((p) => nsn.startsWith(p))) return c;
  }
  return null;
}

export function walletById(country: Country, id: string | null | undefined): Wallet | null {
  const wanted = String(id ?? "").toLowerCase();
  return country.wallets.find((w) => w.id === wanted) ?? null;
}

export function walletByPawapay(code: string): { country: Country; wallet: Wallet } | null {
  for (const country of COUNTRIES) {
    const wallet = country.wallets.find((w) => w.pawapay === code);
    if (wallet) return { country, wallet };
  }
  return null;
}

const SPOKEN: Record<string, string> = {
  KES: "shillings", UGX: "shillings", TZS: "shillings", RWF: "francs", XOF: "francs", XAF: "francs", CDF: "francs",
  GHS: "cedis", NGN: "naira", ZMW: "kwacha", MWK: "kwacha", MZN: "meticais", ETB: "birr", LSL: "maloti", SLE: "leones",
};

/** How the voice line reads a currency aloud: "shillings", "cedis"... */
export function spokenCurrency(currency: string): string {
  return SPOKEN[currency] ?? currency;
}

/** Finds a wallet from a word a student typed: "mtn", "MPESA", "orange", "airtel"... */
export function walletFromWord(country: Country, word: string): Wallet | null {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return null;
  return country.wallets.find((x) => x.id === w || x.label.toLowerCase().replace(/[^a-z]/g, "").startsWith(w)) ?? null;
}

/** Short money label: "KES 1,000", "XOF 5,000". */
export function money(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
}
