// Pin roles and their colors (CSS variables from app.css).
export type Role = "tdi" | "tdo" | "tck" | "tms" | "trst" | "rtck" | "swdio" | "swclk" | "txd" | "rxd" | "bsr";

export const ROLE_COLOR: Record<Role, string> = {
  tdi: "var(--sig-tdi)",
  tdo: "var(--sig-tdo)",
  tck: "var(--sig-tck)",
  tms: "var(--sig-tms)",
  trst: "var(--sig-trst)",
  rtck: "var(--sig-rtck)",
  swdio: "var(--sig-swdio)",
  swclk: "var(--sig-swclk)",
  txd: "var(--sig-txd)",
  rxd: "var(--sig-rxd)",
  bsr: "var(--sig-bsr)",
};

export const ROLE_LABEL: Record<Role, string> = {
  tdi: "TDI",
  tdo: "TDO",
  tck: "TCK",
  tms: "TMS",
  trst: "TRST#",
  rtck: "RTCK",
  swdio: "SWDIO",
  swclk: "SWCLK",
  txd: "TXD",
  rxd: "RXD",
  bsr: "BSR",
};

export type PinMap = Partial<Record<number, Role[]>>;

export function pinMap(entries: [Role, number | null | undefined][]): PinMap {
  const m: PinMap = {};
  for (const [r, ch] of entries) if (ch !== null && ch !== undefined && ch >= 0) (m[ch] ??= []).push(r);
  return m;
}

export const fmtMs = (ms: number) => {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};

export const fmtBaud = (b: number) => (b >= 1000 ? `${b % 1000 === 0 ? b / 1000 : (b / 1000).toFixed(1)}k` : String(b));
