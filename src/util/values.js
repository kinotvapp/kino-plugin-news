// Defensive readers for values that come from storage or another device: object, string, https address, time.

export const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
export const httpsOrNull = (v, max = 1000) => (typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v) && v.length <= max ? v : null);
export const time = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
