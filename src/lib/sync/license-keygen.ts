import type { LicensePlan } from "./license-contracts";

// Characters excluding ambiguous: 0/O, 1/I/L
const CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomSegment(length: number): string {
  // Rejection sampling to avoid modulo bias (256 % 31 ≠ 0)
  const maxUnbiased = 256 - (256 % CHARSET.length); // 248
  const result: string[] = [];
  while (result.length < length) {
    const bytes = new Uint8Array(length - result.length + 4);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < maxUnbiased) {
        result.push(CHARSET[b % CHARSET.length]);
        if (result.length === length) break;
      }
    }
  }
  return result.join("");
}

function crc16(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

function crc16ToSegment(crc: number): string {
  let result = "";
  let value = crc;
  for (let i = 0; i < 4; i++) {
    result = CHARSET[value % CHARSET.length] + result;
    value = Math.floor(value / CHARSET.length);
  }
  return result;
}

export function generateLicenseKey(plan: LicensePlan): string {
  const planMap: Record<LicensePlan, string> = {
    free: "FRE",
    starter: "STA",
    pro: "PRO",
    enterprise: "ENT",
  };
  const year = new Date().getFullYear().toString();
  const seg1 = randomSegment(4);
  const seg2 = randomSegment(4);

  const prefix = `TF-${planMap[plan]}-${year}-${seg1}-${seg2}`;
  const checksum = crc16(prefix);
  const seg3 = crc16ToSegment(checksum);

  return `${prefix}-${seg3}`;
}

export function validateKeyFormat(key: string): boolean {
  const pattern = /^TF-(FRE|STA|PRO|ENT)-\d{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/;
  if (!pattern.test(key)) return false;

  const lastDash = key.lastIndexOf("-");
  const prefix = key.slice(0, lastDash);
  const checksumSegment = key.slice(lastDash + 1);

  const expectedCrc = crc16(prefix);
  const expectedSegment = crc16ToSegment(expectedCrc);

  return checksumSegment === expectedSegment;
}
