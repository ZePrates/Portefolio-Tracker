import { describe, expect, it } from "vitest";
import { fetchWithTimeout, mapWithConcurrency } from "./http";

const noSleep = async () => {};

describe("fetchWithTimeout", () => {
  it("repete em 5xx e devolve a resposta seguinte", async () => {
    const calls: number[] = [];
    const fake = (async () => {
      calls.push(1);
      return new Response("x", { status: calls.length === 1 ? 503 : 200 });
    }) as typeof fetch;
    const res = await fetchWithTimeout("https://x", {}, { fetchImpl: fake, sleep: noSleep });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("não repete em 404", async () => {
    let n = 0;
    const fake = (async () => {
      n++;
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const res = await fetchWithTimeout("https://x", {}, { fetchImpl: fake, sleep: noSleep });
    expect(res.status).toBe(404);
    expect(n).toBe(1);
  });

  it("aborta pedidos lentos (timeout) e lança após esgotar tentativas", async () => {
    const slow = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    await expect(
      fetchWithTimeout(
        "https://x",
        {},
        { fetchImpl: slow, timeoutMs: 5, retries: 1, sleep: noSleep },
      ),
    ).rejects.toThrow("aborted");
  });
});

describe("mapWithConcurrency", () => {
  it("mantém a ordem e respeita o limite", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (x) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return x * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
