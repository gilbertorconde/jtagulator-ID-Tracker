// Session: owns a Transport and turns the byte stream into something you can
// converse with (send text, wait for patterns), like a tiny `expect`.
import { Emitter, bytes, latin1, type Transport } from "./transport";

export class AbortedError extends Error {
  constructor(msg = "Aborted") {
    super(msg);
    this.name = "AbortedError";
  }
}

export class TimeoutError extends Error {
  constructor(public pattern: string, public tail: string) {
    super(`Timed out waiting for ${pattern}`);
    this.name = "TimeoutError";
  }
}

export interface ExpectResult {
  index: number;
  match: RegExpExecArray;
  /** Text between the read cursor and the start of the match. */
  before: string;
}

interface Waiter {
  patterns: RegExp[];
  resolve: (r: ExpectResult) => void;
  reject: (e: Error) => void;
}

/** Size of the rolling buffer kept for matching. Prompts are short; scans can be chatty. */
const MAX_BUFFER = 64 * 1024;

export class Session {
  /** Unconsumed received text. */
  private buf = "";
  private waiter: Waiter | null = null;
  private unsubs: (() => void)[] = [];
  private lock: Promise<void> = Promise.resolve();
  private _busy = 0;

  readonly rx = new Emitter<string>();
  readonly tx = new Emitter<string>();
  readonly closed = new Emitter<string>();
  readonly busyChange = new Emitter<boolean>();
  open = false;

  constructor(public readonly transport: Transport) {}

  async connect() {
    this.unsubs.push(this.transport.onData((d) => this.feed(latin1(d))));
    this.unsubs.push(
      this.transport.onClose((reason) => {
        this.open = false;
        this.waiter?.reject(new AbortedError(`Port closed: ${reason}`));
        this.waiter = null;
        this.closed.emit(reason);
      }),
    );
    await this.transport.open();
    this.open = true;
  }

  async disconnect() {
    this.open = false;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.waiter?.reject(new AbortedError("Disconnected"));
    this.waiter = null;
    await this.transport.close();
    this.closed.emit("disconnected");
  }

  get busy() {
    return this._busy > 0;
  }

  private feed(text: string) {
    this.rx.emit(text);
    this.buf += text;
    if (this.buf.length > MAX_BUFFER) this.buf = this.buf.slice(-MAX_BUFFER / 2);
    this.check();
  }

  private check() {
    const w = this.waiter;
    if (!w) return;
    let best: ExpectResult | null = null;
    w.patterns.forEach((re, index) => {
      re.lastIndex = 0;
      const m = re.exec(this.buf);
      if (m && (!best || m.index < best.match.index)) best = { index, match: m, before: this.buf.slice(0, m.index) };
    });
    if (best) {
      const r = best as ExpectResult;
      this.buf = this.buf.slice(r.match.index + r.match[0].length);
      this.waiter = null;
      w.resolve(r);
    }
  }

  async write(data: string | Uint8Array) {
    const b = typeof data === "string" ? bytes(data) : data;
    this.tx.emit(typeof data === "string" ? data : latin1(data));
    await this.transport.write(b);
  }

  /** Drop everything received so far. */
  flush() {
    this.buf = "";
  }

  /** Peek at what has been received but not consumed. */
  pending() {
    return this.buf;
  }

  /**
   * Wait until one of `patterns` matches the unconsumed input. The earliest
   * match wins; input up to the end of the match is consumed.
   */
  expect(patterns: RegExp | RegExp[], opts: { timeout?: number; signal?: AbortSignal } = {}): Promise<ExpectResult> {
    const list = Array.isArray(patterns) ? patterns : [patterns];
    if (this.waiter) return Promise.reject(new Error("Session already has a pending expect()"));
    if (!this.open) return Promise.reject(new AbortedError("Not connected"));
    return new Promise<ExpectResult>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (this.waiter === w) this.waiter = null;
        cleanup();
        reject(new AbortedError());
      };
      const w: Waiter = {
        patterns: list,
        resolve: (r) => (cleanup(), resolve(r)),
        reject: (e) => (cleanup(), reject(e)),
      };
      if (opts.signal?.aborted) return reject(new AbortedError());
      opts.signal?.addEventListener("abort", onAbort);
      if (opts.timeout && opts.timeout > 0) {
        timer = setTimeout(() => {
          if (this.waiter === w) this.waiter = null;
          cleanup();
          reject(new TimeoutError(list.map(String).join(" | "), this.buf.slice(-200)));
        }, opts.timeout);
      }
      this.waiter = w;
      this.check();
    });
  }

  /** Take exclusive use of the session; call the returned function to release it. */
  async acquire(): Promise<() => void> {
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((r) => (release = r));
    await prev;
    this._busy++;
    this.busyChange.emit(true);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this._busy--;
      this.busyChange.emit(this._busy > 0);
      release();
    };
  }

  /** Run `fn` with exclusive use of the session (operations are serialized). */
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
