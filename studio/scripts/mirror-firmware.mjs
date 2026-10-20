// Copies every firmware release's .binary/.eeprom files into the web build
// (dist/firmware/<tag>/) and writes dist/firmware/releases.json listing them.
// A page in a browser can't fetch GitHub release downloads (no CORS headers),
// but it can fetch files from its own site.
//
//   node scripts/mirror-firmware.mjs <owner/repo> <out dir>    (GITHUB_TOKEN optional)
import fs from "node:fs";
import path from "node:path";

const [repo = "gilbertorconde/jtagulator-ID-Tracker", out = "dist/firmware"] = process.argv.slice(2);
const headers = { "User-Agent": "jtagulator-studio-mirror", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, { headers: { ...headers, Accept: "application/vnd.github+json" } });
if (!res.ok) throw new Error(`Listing releases: HTTP ${res.status}`);
const releases = (await res.json()).filter((r) => !r.draft);

const list = [];
for (const r of releases) {
  const files = r.assets.filter((a) => /\.(binary|eeprom)$/i.test(a.name));
  if (!files.length) continue;
  const dir = path.join(out, r.tag_name);
  fs.mkdirSync(dir, { recursive: true });
  const assets = [];
  for (const a of files) {
    const dl = await fetch(a.url, { headers: { ...headers, Accept: "application/octet-stream" } });
    if (!dl.ok) throw new Error(`${a.name}: HTTP ${dl.status}`);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    if (bytes.length !== a.size) throw new Error(`${a.name}: got ${bytes.length} bytes, expected ${a.size}`);
    fs.writeFileSync(path.join(dir, a.name), bytes);
    assets.push({ name: a.name, url: `firmware/${encodeURIComponent(r.tag_name)}/${encodeURIComponent(a.name)}`, size: a.size });
  }
  list.push({
    tag: r.tag_name,
    name: r.name || r.tag_name,
    version: r.tag_name.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null,
    published: r.published_at,
    notes: r.body ?? "",
    htmlUrl: r.html_url,
    assets,
  });
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "releases.json"), JSON.stringify({ repo, mirroredAt: new Date().toISOString(), releases: list }, null, 1));
console.log(`mirrored ${list.length} firmware release(s), ${list.reduce((n, r) => n + r.assets.length, 0)} file(s)`);
