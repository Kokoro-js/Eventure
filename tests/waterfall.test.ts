import { describe, it, expect } from "bun:test";
import { Eventure } from "@/index";
import type { IEventMap } from "@/types";

/**
 * Define events with waterfall-signature for testing.
 */
interface NumberPipelineEvents extends IEventMap {
  // Returns number, next should also return number
  numEvent: (value: number, next: (value: number) => number) => number;
}

describe("waterfall - number pipeline with explicit inner", () => {
  it("should invoke listeners in order and return correct final value", () => {
    const calls: string[] = [];
    const em = new Eventure<NumberPipelineEvents>({});

    // Listener 1: adds 1
    em.on("numEvent", (value, next) => {
      calls.push("first");
      return next(value + 1);
    });

    // Listener 2: multiplies by 2
    em.on("numEvent", (value, next) => {
      calls.push("second");
      return next(value * 2);
    });

    // Execute waterfall with initial value 5 and custom inner: subtract 3
    const result = em.waterfall(
      "numEvent",
      5,
      (final) => {
        calls.push("inner");
        return final - 3;
      }
    );

    // Order: first -> second -> inner
    expect(calls).toEqual(["first", "second", "inner"]);
    // Computation: ((5 + 1) * 2) - 3 = (6 * 2) - 3 = 12 - 3 = 9
    expect(result).toBe(9);
  });
});

/**
 * Define events with void pipeline for testing default inner
 */
interface VoidPipelineEvents extends IEventMap {
  // Returns void, next returns void
  voidEvent: (text: string, next: (text: string) => void) => void;
}

describe("waterfall - void pipeline with default inner", () => {
  it("should invoke all listeners and complete without errors", () => {
    const calls: string[] = [];
    const em = new Eventure<VoidPipelineEvents>({});

    // Listener 1
    em.on("voidEvent", (text, next) => {
      calls.push(`L1:${text}`);
      next(text + ":step1");
    });

    // Listener 2
    em.on("voidEvent", (text, next) => {
      calls.push(`L2:${text}`);
      next(text + ":step2");
    });

    // Invoke waterfall without providing inner, default no-op inner used
    const returnValue = em.waterfall("voidEvent", "start");

    // Both listeners should have been called in sequence
    expect(calls).toEqual(["L1:start", "L2:start:step1"]);
    // For void pipelines, returnValue should be undefined
    expect(returnValue).toBeUndefined();
  });
});
