// tests/waitFor.test.ts
import { describe, it, expect } from "bun:test";
import { Eventure } from "@/index";
import type { IEventMap } from "@/types";

interface MyEvents extends IEventMap {
  ready: [];
  data: [number];
}

describe("Eventified.waitFor", () => {
  it("should resolve when the event is emitted", async () => {
    const emitter = new Eventure<MyEvents>();

    const p = emitter.waitFor("data", 1000);
    // emit after a tick
    setTimeout(() => {
      emitter.emit("data", 42);
    }, 0);

    const args = await p;
    expect(args).toEqual([42]);
  });

  it("should reject on timeout", async () => {
    const emitter = new Eventure<MyEvents>();
    const timeoutMs = 50;

    const p = emitter.waitFor("ready", timeoutMs);
    await expect(p).rejects.toThrow(`waitFor 'ready' timeout after ${timeoutMs}ms`);
  });

  it("should not resolve after cancel is called", async () => {
    const emitter = new Eventure<MyEvents>();
    const p = emitter.waitFor("data", 1000);

    // cancel immediately
    p.cancel();

    // try to emit right away
    emitter.emit("data", 99);

    // race between p and a short timer to detect if p ever resolves
    const result = await Promise.race([
      p.then(() => "resolved").catch(() => "rejected"),
      new Promise<string>((r) => setTimeout(() => r("no-resolve"), 50)),
    ]);

    expect(result).toBe("no-resolve");
  });
});
