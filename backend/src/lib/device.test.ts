import { describe, expect, it } from "vitest";
import { isPhoneUserAgent } from "./device.js";

describe("isPhoneUserAgent", () => {
  it("phones", () => {
    expect(isPhoneUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(isPhoneUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")).toBe(true);
  });
  it("tablets and computers are not phones", () => {
    expect(isPhoneUserAgent("Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/120.0 Safari/537.36")).toBe(false);
    expect(isPhoneUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15")).toBe(false);
    expect(isPhoneUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36")).toBe(false);
  });
});
