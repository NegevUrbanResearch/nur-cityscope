const HEX = "0123456789abcdef";

export function createUuid(cryptoObject = globalThis.crypto) {
  if (typeof cryptoObject?.randomUUID === "function") return cryptoObject.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoObject?.getRandomValues === "function") cryptoObject.getRandomValues(bytes);
  else throw new Error("secure random UUID generation is unavailable");
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let value = "";
  for (let i = 0; i < bytes.length; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) value += "-";
    value += HEX[(bytes[i] >> 4) & 0xf] + HEX[bytes[i] & 0xf];
  }
  return value;
}

export const randomUuid = createUuid;
