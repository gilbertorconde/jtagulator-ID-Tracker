#!/usr/bin/env node
// Entry point: wires main() to the process. Ctrl-C stops a running scan; a second Ctrl-C quits.
import { main } from "./main";

const ctl = new AbortController();
let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  process.stderr.write("\nStopping… (Ctrl-C again to quit)\n");
  ctl.abort();
});

const code = await main(process.argv.slice(2), {
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s),
  tty: process.stderr.isTTY,
  signal: ctl.signal,
});
process.exit(code);
