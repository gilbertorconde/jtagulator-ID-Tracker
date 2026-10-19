// Capture export: Value Change Dump (IEEE 1364) and CSV.
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

/** Base filename for a capture, e.g. "jtagulator-capture-20261019-142501". */
export function captureFileName(cap: Capture): string {
  const d = new Date(cap.capturedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  return `jtagulator-capture-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Offer text as a file download (browser / webview). */
export function downloadText(filename: string, text: string, mime = "text/plain") {
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
