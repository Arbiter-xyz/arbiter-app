import { describe, expect, it } from "vitest";
import { workerProfileUrl } from "./format.js";

describe("workerProfileUrl (#462)", () => {
  it("links a Stellar address to worker.html", () => {
    const id = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";
    expect(workerProfileUrl(id)).toBe(`/worker.html?address=${id}`);
  });

  it("encodes ids that are not plain addresses", () => {
    expect(workerProfileUrl("a b&c=d/e?f#g")).toBe(
      "/worker.html?address=a%20b%26c%3Dd%2Fe%3Ff%23g",
    );
    expect(
      new URLSearchParams(workerProfileUrl("x&y=z").split("?")[1]).get(
        "address",
      ),
    ).toBe("x&y=z");
  });
});
