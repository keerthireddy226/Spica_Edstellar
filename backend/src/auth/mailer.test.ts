import { afterEach, describe, expect, it, vi } from "vitest";
import { sendViaBrevo } from "./mailer.js";

const okFetch = () => vi.fn(async () => new Response("{}", { status: 201 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("sendViaBrevo", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("posts the email to Brevo's API with the key and sender", async () => {
    vi.stubEnv("BREVO_SENDER_EMAIL", "keerthi.r@edstellar.com");
    const f = okFetch();
    await sendViaBrevo({ to: "a@b.com", subject: "Hi", text: "Body" }, "key-1", f);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("key-1");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ sender: { email: "keerthi.r@edstellar.com", name: "Spica" }, to: [{ email: "a@b.com" }], subject: "Hi", textContent: "Body" });
    expect(body.attachment).toBeUndefined();
  });

  it("sends attachments base64-encoded and keeps extra headers", async () => {
    vi.stubEnv("BREVO_SENDER_EMAIL", "s@x.com");
    const f = okFetch();
    await sendViaBrevo(
      { to: "a@b.com", subject: "S", text: "T", headers: { "List-Unsubscribe": "<u>" }, attachments: [{ filename: "p.ics", content: "BEGIN:VCALENDAR", contentType: "text/calendar" }] },
      "k",
      f,
    );
    const body = JSON.parse(String((f.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.headers).toEqual({ "List-Unsubscribe": "<u>" });
    expect(body.attachment).toEqual([{ name: "p.ics", content: Buffer.from("BEGIN:VCALENDAR").toString("base64") }]);
  });

  it("throws with Brevo's reply when it refuses", async () => {
    vi.stubEnv("BREVO_SENDER_EMAIL", "s@x.com");
    const f = vi.fn(async () => new Response('{"message":"sender not valid"}', { status: 400 })) as unknown as typeof fetch;
    await expect(sendViaBrevo({ to: "a@b.com", subject: "S", text: "T" }, "k", f)).rejects.toThrow(/400.*sender not valid/);
  });
});
