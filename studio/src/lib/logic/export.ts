// Capture export: Value Change Dump (IEEE 1364), CSV, and sigrok session files (.sr).
import type { Capture } from "./sump";

export interface ExportOptions {
  /** Display names per channel (index = channel). Defaults to CHn. */
  names?: (string | undefined)[];
  /** Channels to include; defaults to every captured channel. */
  channels?: number[];
}

const capturedChannels = (cap: Capture, o: ExportOptions) =>
  o.channels ?? Array.from({ length: 24 }, (_, i) => i).filter((c) => (cap.channelMask >>> c) & 1);

const nameOf = (o: ExportOptions, ch: number) => o.names?.[ch]?.trim() || `CH${ch}`;

/** VCD identifier codes: printable ASCII from '!'. */
const vcdId = (i: number) => {
  let s = "";
  do {
    s += String.fromCharCode(33 + (i % 94));
    i = Math.floor(i / 94) - 1;
  } while (i >= 0);
  return s;
};

/** Pick the coarsest of ns / ps that represents one sample period exactly (else ps, rounded). */
function timescale(rateHz: number): { unit: "ns" | "ps"; perSample: number } {
  const ns = 1e9 / rateHz;
  if (Math.abs(ns - Math.round(ns)) < 1e-6 && Math.round(ns) >= 1) return { unit: "ns", perSample: Math.round(ns) };
  return { unit: "ps", perSample: Math.round(1e12 / rateHz) };
}

export function toVCD(cap: Capture, o: ExportOptions & { comment?: string } = {}): string {
  const chans = capturedChannels(cap, o);
  const { unit, perSample } = timescale(cap.sampleRateHz);
  const ids = chans.map((_, i) => vcdId(i));
  const lines: string[] = [];
  lines.push(`$date ${new Date(cap.capturedAt).toISOString()} $end`);
  lines.push("$version JTAGulator Studio logic analyzer $end");
  lines.push(
    `$comment ${o.comment ?? `${cap.samples.length} samples at ${cap.sampleRateHz} Hz` + (cap.triggerIndex !== null ? `, trigger at sample ${cap.triggerIndex}` : "")} $end`,
  );
  lines.push(`$timescale 1 ${unit} $end`);
  lines.push("$scope module jtagulator $end");
  chans.forEach((ch, i) => lines.push(`$var wire 1 ${ids[i]} ${nameOf(o, ch).replace(/\s+/g, "_")} $end`));
  lines.push("$upscope $end");
  lines.push("$enddefinitions $end");
  const s = cap.samples;
  if (s.length) {
    lines.push("#0");
    lines.push("$dumpvars");
    chans.forEach((ch, i) => lines.push(`${(s[0] >>> ch) & 1}${ids[i]}`));
    lines.push("$end");
    let watch = 0;
    for (const ch of chans) watch |= 1 << ch;
    for (let k = 1; k < s.length; k++) {
      const diff = ((s[k] ^ s[k - 1]) & watch) >>> 0;
      if (!diff) continue;
      lines.push(`#${k * perSample}`);
      chans.forEach((ch, i) => {
        if ((diff >>> ch) & 1) lines.push(`${(s[k] >>> ch) & 1}${ids[i]}`);
      });
    }
    lines.push(`#${s.length * perSample}`);
  }
  return lines.join("\n") + "\n";
}

export function toCSV(cap: Capture, o: ExportOptions = {}): string {
  const chans = capturedChannels(cap, o);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [["sample", "time_s", ...chans.map((c) => esc(nameOf(o, c)))].join(",")];
  const dt = 1 / cap.sampleRateHz;
  const s = cap.samples;
  for (let k = 0; k < s.length; k++) {
    let r = `${k},${+(k * dt).toPrecision(12)}`;
    for (const ch of chans) r += "," + ((s[k] >>> ch) & 1);
    rows.push(r);
  }
  return rows.join("\n") + "\n";
}

// ------------------------------------------------------------- sigrok .sr

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive with every file stored uncompressed. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(12, 0x21, true); // 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, f.data);
    central.push(cd);
    offset += local.length + f.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + end.length);
  let p = 0;
  for (const b of [...parts, ...central, end]) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

/** Sample rate the way libsigrok writes it ("1 MHz", "909.09 kHz"). */
function srRate(hz: number): string {
  const [div, unit] = hz >= 1e9 && hz % 1e6 === 0 ? [1e9, "GHz"] : hz >= 1e6 ? [1e6, "MHz"] : hz >= 1e3 ? [1e3, "kHz"] : [1, "Hz"];
  return `${+(hz / div).toFixed(6)} ${unit}`;
}

/**
 * A sigrok session file (srzip v2) that opens in PulseView and sigrok-cli, so
 * every sigrok protocol decoder can run on the capture. All 24 channels are
 * stored as 3 bytes per sample; channels outside the capture read as 0.
 */
export function toSigrok(cap: Capture, o: Pick<ExportOptions, "names"> = {}): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const meta = [
    "[global]",
    "sigrok version=0.5.2",
    "",
    "[device 1]",
    "capturefile=logic-1",
    "total probes=24",
    `samplerate=${srRate(cap.sampleRateHz)}`,
    "total analog=0",
    ...Array.from({ length: 24 }, (_, ch) => `probe${ch + 1}=${nameOf(o, ch).replace(/[\r\n=\[\]]/g, "_")}`),
    "unitsize=3",
    "",
  ].join("\n");
  const data = new Uint8Array(cap.samples.length * 3);
  for (let i = 0; i < cap.samples.length; i++) {
    const v = cap.samples[i];
    data[3 * i] = v & 0xff;
    data[3 * i + 1] = (v >>> 8) & 0xff;
    data[3 * i + 2] = (v >>> 16) & 0xff;
  }
  return zipStore([
    { name: "version", data: enc.encode("2") },
    { name: "metadata", data: enc.encode(meta) },
    { name: "logic-1-1", data },
  ]);
}

/** Base filename for a capture, e.g. "jtagulator-capture-20261019-142501". */
export function captureFileName(cap: Capture): string {
  const d = new Date(cap.capturedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  return `jtagulator-capture-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Offer text as a file download (browser / webview). */
export function downloadText(filename: string, text: string | Uint8Array<ArrayBuffer>, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
