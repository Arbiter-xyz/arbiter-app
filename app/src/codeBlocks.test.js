import { describe, expect, it } from "vitest";
import { parseFences } from "./codeBlocks.js";

const code = (segments) => segments.filter((s) => s.type === "code");

describe("parseFences (#464)", () => {
  it("keeps the first word of a single-line fence", () => {
    expect(code(parseFences("run ```npm install foo``` now"))).toEqual([
      { type: "code", code: "npm install foo", language: "" },
    ]);
  });

  it("still reads a language tag followed by a newline", () => {
    expect(code(parseFences("```js\nlet a```"))).toEqual([
      { type: "code", code: "let a", language: "js" },
    ]);
    expect(code(parseFences("```Rust\nfn x() {}\n```"))[0].language).toBe(
      "rust",
    );
  });

  it("treats a single word fence as code, not a language", () => {
    expect(code(parseFences("```npm```"))).toEqual([
      { type: "code", code: "npm", language: "" },
    ]);
  });

  it("keeps surrounding text and adjacent blocks (#318)", () => {
    const s = parseFences("a ```js\nx\n``` ```py\ny\n``` b");
    expect(s.map((x) => x.type)).toEqual([
      "text",
      "code",
      "text",
      "code",
      "text",
    ]);
    expect(s[0].text).toBe("a ");
    expect(s[4].text).toBe(" b");
  });

  it("leaves an unterminated fence as plain text (#318)", () => {
    expect(parseFences("```js\nlet x = 1")).toEqual([
      { type: "text", text: "```js\nlet x = 1" },
    ]);
  });
});
