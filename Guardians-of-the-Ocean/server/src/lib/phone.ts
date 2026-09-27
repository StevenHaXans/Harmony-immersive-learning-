/**
 * Phone numbers for every country in lib/countries.ts. Everything is stored as E.164 digits
 * without the plus (254712345678, 256772123456, 2250701234567...).
 * Numbers typed without a country code are read in the default country (DEFAULT_COUNTRY).
 */
import { COUNTRIES, Country, countryByCode, countryOfDigits } from "./countries.js";

let defaultCountry: Country = countryByCode("KE")!;

export function setDefaultCountry(code: string): void {
  defaultCountry = countryByCode(code) ?? defaultCountry;
}

export function getDefaultCountry(): Country {
  return defaultCountry;
}

/** Returns E.164 digits for a supported African mobile number, or "". */
export function normalizePhone(raw: unknown, countryCode?: string): string {
  let text = String(raw ?? "").trim();
  const international = text.startsWith("+") || text.startsWith("00");
  let digits = text.replace(/\D/g, "");
  if (text.startsWith("00")) digits = digits.slice(2);
  if (!digits) return "";

  if (international) return countryOfDigits(digits) ? digits : "";

  const home = countryByCode(countryCode) ?? defaultCountry;
  // Local formats in the home country first: 0712..., 712..., and numbers where the 0 is part of the number.
  const local = home.trunk0 && digits.startsWith("0") ? digits.slice(1) : digits;
  if (home.nsn.includes(local.length) && !(home.trunk0 && local.startsWith("0")) && countryOfDigits(home.dial + local) === home) return home.dial + local;
  // Already international, just without the plus.
  if (countryOfDigits(digits)) return digits;
  return "";
}

export function countryOf(phone: string): Country | null {
  const n = normalizePhone(phone);
  return n ? countryOfDigits(n) : null;
}

/** National significant number (no country code, no trunk 0). */
export function nationalNumber(phone: string): string {
  const n = normalizePhone(phone);
  const c = n ? countryOfDigits(n) : null;
  return c ? n.slice(c.dial.length) : "";
}

/** Network id from lib/countries.ts ("safaricom", "mtn", ...), or "unknown". */
export function networkOf(phone: string, mccmnc?: string): string {
  const n = normalizePhone(phone);
  const c = n ? countryOfDigits(n) : null;
  if (!c) return "unknown";
  if (mccmnc) {
    const byCode = c.networks.find((net) => net.mccmnc?.includes(String(mccmnc)));
    if (byCode) return byCode.id;
  }
  const nsn = n.slice(c.dial.length);
  let best: { id: string; len: number } | null = null;
  for (const net of c.networks) {
    for (const p of net.prefixes) {
      if (nsn.startsWith(p) && (!best || p.length > best.len)) best = { id: net.id, len: p.length };
    }
  }
  return best?.id ?? "unknown";
}

export function networkName(phone: string): string {
  const c = countryOf(phone);
  const id = networkOf(phone);
  return c?.networks.find((n) => n.id === id)?.name ?? "";
}

/** +2547XXXXXXXX, the form gateways expect. */
export function e164(phone: string): string {
  const n = normalizePhone(phone);
  return n ? `+${n}` : "";
}

function groups(nsn: string): string {
  return nsn.length <= 8 ? nsn.replace(/(\d{2})(?=\d)/g, "$1 ").trim() : `${nsn.slice(0, 3)} ${nsn.slice(3, 6)} ${nsn.slice(6)}`;
}

/** Home-country numbers in local style (0712 345 678); others international (+256 772 123 456). */
export function prettyPhone(phone: string): string {
  const n = normalizePhone(phone);
  const c = n ? countryOfDigits(n) : null;
  if (!c) return String(phone || "");
  const nsn = n.slice(c.dial.length);
  if (c.code === defaultCountry.code && c.trunk0) {
    const local = "0" + nsn;
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  return `+${c.dial} ${groups(nsn)}`;
}

/** Last three digits only, for logs and anything a third party might read. */
export function maskPhone(phone: string): string {
  const n = normalizePhone(phone);
  const c = n ? countryOfDigits(n) : null;
  if (!c) return "unknown";
  const nsn = n.slice(c.dial.length);
  if (c.code === defaultCountry.code && c.trunk0) {
    const local = "0" + nsn;
    return `${local.slice(0, 4)} ***${local.slice(-3)}`;
  }
  return `+${c.dial} ${nsn.slice(0, 3)} ***${nsn.slice(-3)}`;
}

export { COUNTRIES };
