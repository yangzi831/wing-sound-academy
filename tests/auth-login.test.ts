import { describe, it, expect, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { requestEmailAccess, emailAccessError } from "../src/auth-login";
describe("email registration / sign-in", () => {
  it.each([true, false])(
    "sends create_user=%s for academy=true / legacy=false through the real SDK",
    async (academy) => {
      const fetcher = vi.fn(
        async () =>
          new Response("{}", {
            headers: { "Content-Type": "application/json" },
          }),
      );
      const client = createClient("https://test.supabase.co", "TEST_PUBLIC", {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          flowType: "implicit",
        },
        global: { fetch: fetcher },
      });
      const redirect = "https://yangzi831.github.io/wing-sound-academy/";
      await requestEmailAccess(
        client.auth,
        " Friend@Example.com ",
        academy,
        redirect,
      );
      const [url, init] = fetcher.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(new URL(url).pathname).toBe("/auth/v1/otp");
      expect(new URL(url).searchParams.get("redirect_to")).toBe(redirect);
      expect(JSON.parse(String(init.body))).toMatchObject({
        email: "friend@example.com",
        create_user: academy,
      });
      expect(JSON.parse(String(init.body))).not.toHaveProperty("email_confirm");
      expect(JSON.parse(String(init.body)).code_challenge).toBeFalsy();
    },
  );
  it("does not report success when registration or SMTP is rejected", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "signup_disabled",
            msg: "Signups not allowed for this instance",
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
    );
    const client = createClient("https://test.supabase.co", "TEST_PUBLIC", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetcher },
    });
    await expect(
      requestEmailAccess(
        client.auth,
        "friend@example.com",
        true,
        "https://example.com/",
      ),
    ).rejects.toThrow("Signups not allowed");
    expect(emailAccessError({ code: "signup_disabled" })).toContain(
      "Allow new users to sign up",
    );
    expect(
      emailAccessError({ message: "Signups not allowed for this instance" }),
    ).toContain("邮箱确认应保持开启");
    expect(emailAccessError({ status: 429 })).toContain("频率受限");
    expect(emailAccessError({ code: "otp_expired" })).toContain("最新");
  });
});
