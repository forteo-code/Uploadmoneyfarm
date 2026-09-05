import maxmind, { type CityResponse, type AsnResponse, type Reader } from "maxmind";
import { env } from "../env.js";
import { logger } from "./logger.js";

let countryReader: Reader<CityResponse> | null = null;
let asnReader: Reader<AsnResponse> | null = null;

/**
 * GeoIP drives both halves of the margin equation: which CPM tier an impression
 * is worth, and which quality ceiling we are willing to spend bandwidth on.
 * Without the databases everything degrades to tier 3 / 480p, which is the safe
 * direction to fail in - we under-serve quality rather than over-spend.
 */
export async function initGeo(): Promise<void> {
  try {
    if (env.GEOIP_COUNTRY_DB) countryReader = await maxmind.open<CityResponse>(env.GEOIP_COUNTRY_DB);
    if (env.GEOIP_ASN_DB) asnReader = await maxmind.open<AsnResponse>(env.GEOIP_ASN_DB);
    logger.info(
      { country: !!countryReader, asn: !!asnReader },
      "geoip databases loaded",
    );
  } catch (err) {
    logger.warn({ err }, "geoip unavailable; defaulting all traffic to tier 3 / 480p");
  }
}

export function lookupCountry(ip: string): string | null {
  if (!countryReader) return null;
  try {
    return countryReader.get(ip)?.country?.iso_code ?? null;
  } catch {
    return null;
  }
}

export function lookupAsn(ip: string): { asn: number | null; org: string | null } {
  if (!asnReader) return { asn: null, org: null };
  try {
    const r = asnReader.get(ip);
    return { asn: r?.autonomous_system_number ?? null, org: r?.autonomous_system_organization ?? null };
  } catch {
    return { asn: null, org: null };
  }
}

/**
 * Datacenter and hosting ASNs are the cheapest signal against view farming:
 * real viewers are on residential or mobile networks. This is a coarse
 * substring match on the ASN organisation, which catches naive farming but not
 * a residential proxy pool - see the fraud notes in routes/track.ts.
 */
const HOSTING_HINTS = [
  "amazon", "aws", "google", "microsoft", "azure", "digitalocean", "linode",
  "vultr", "hetzner", "ovh", "scaleway", "contabo", "leaseweb", "choopa",
  "cloudflare", "oracle", "alibaba", "tencent", "m247", "datacamp", "hostwinds",
  "colocrossing", "quadranet", "psychz", "servers.com", "hosting", "datacenter",
  "data center", "vps", "cloud",
];

export function isDatacenterOrg(org: string | null): boolean {
  if (!org) return false;
  const o = org.toLowerCase();
  return HOSTING_HINTS.some((h) => o.includes(h));
}
