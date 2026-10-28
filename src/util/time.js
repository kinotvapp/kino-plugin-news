// Dates: an RSS (RFC 822) date read, and «hace 2 h» / “2 h ago” (pure).

const MONTHS_RFC = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Mon, 26 Oct 2026 23:43:01 GMT" as milliseconds since 1970 (UTC; a numeric zone like +0200 is applied), else 0. */
export function rfcTime(s) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s+([+-]\d{4}|[A-Za-z]+))?/.exec(String(s || ""));
  if (!m) return 0;
  const month = MONTHS_RFC.indexOf(m[2].toLowerCase());
  if (month < 0) return 0;
  let t = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  if (m[7] && /^[+-]\d{4}$/.test(m[7])) {
    const sign = m[7][0] === "-" ? -1 : 1;
    t -= sign * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3, 5))) * 60000;
  }
  return Number.isFinite(t) ? t : 0;
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** How long ago [ts] was at [now], in Spanish or English ("hace 5 min", "3 h ago"); a week or more: the date. */
export function timeAgo(ts, now, en) {
  if (!ts) return "";
  const min = Math.floor((now - ts) / 60000);
  if (min < 1) return en ? "just now" : "ahora";
  if (min < 60) return en ? min + " min ago" : "hace " + min + " min";
  const h = Math.floor(min / 60);
  if (h < 24) return en ? h + " h ago" : "hace " + h + " h";
  const d = Math.floor(h / 24);
  if (d < 7) return en ? (d === 1 ? "1 day ago" : d + " days ago") : (d === 1 ? "hace 1 día" : "hace " + d + " días");
  const date = new Date(ts);
  const mon = (en ? MONTHS_EN : MONTHS_ES)[date.getUTCMonth()];
  return en ? mon + " " + date.getUTCDate() + ", " + date.getUTCFullYear() : date.getUTCDate() + " " + mon + " " + date.getUTCFullYear();
}
