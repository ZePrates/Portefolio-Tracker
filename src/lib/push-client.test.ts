import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./push-client";

describe("urlBase64ToUint8Array", () => {
  it("descodifica base64url sem padding", () => {
    // "hello" em base64url = aGVsbG8
    expect(Array.from(urlBase64ToUint8Array("aGVsbG8"))).toEqual([104, 101, 108, 108, 111]);
  });
  it("trata - e _ do alfabeto url-safe", () => {
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});
