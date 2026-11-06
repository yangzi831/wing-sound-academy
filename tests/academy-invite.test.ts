import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const source = readFileSync(
  new URL("../supabase/functions/academy-invite/index.ts", import.meta.url),
  "utf8",
).replace(/^import \{ createClient \} from [^;]+;\s*/, "");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
}).outputText;
const env: Record<string, string> = {
  SITE_URL: "https://yangzi831.github.io/wing-sound-academy/",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "TEST_SERVER_ONLY",
  SUPABASE_ANON_KEY: "TEST_PUBLIC",
}; // No mail provider key, SMTP password or custom domain.
function handler(factory: typeof createClient) {
  let serve!: (req: Request) => Promise<Response>;
  new Function("createClient", "Deno", compiled)(factory, {
    env: { get: (key: string) => env[key] },
    serve: (fn: typeof serve) => {
      serve = fn;
    },
  });
  return (
    headers: Record<string, string> = {
      Authorization: "Bearer TEST_USER_SESSION",
    },
  ) =>
    serve(
      new Request("https://example.supabase.co/functions/v1/academy-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          academyId: "test-academy",
          email: "Friend@Example.com",
        }),
      }),
    );
}
function setup(
  options: {
    existing?: boolean;
    failMail?: boolean;
    failOtp?: boolean;
    limited?: boolean;
    deny?: boolean;
    invalidSession?: boolean;
    failDelivery?: boolean;
    legacyError?: boolean;
  } = {},
) {
  const deliveries: unknown[] = [],
    order: string[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    order.push(name);
    if (name === "academy_prepare_invitation" && options.deny)
      return { error: { code: "42501", message: "Admin required" } };
    if (name === "academy_invitation_delivery") {
      deliveries.push(args);
      if (args.p_ok && options.failDelivery)
        return { error: { code: "XX000", message: "database unavailable" } };
    }
    return { error: null };
  });
  const inviteUserByEmail = vi.fn(
    async (_email: string, _options: { redirectTo: string }) => {
      order.push("invite");
      return {
        error: options.existing
          ? options.legacyError
            ? {
                status: 422,
                message:
                  "A user with this email address has already been registered",
              }
            : {
                code: "email_exists",
                status: 422,
                message: "Already registered",
              }
          : options.failMail
            ? {
                code: options.limited
                  ? "over_email_send_rate_limit"
                  : "unexpected_failure",
                status: options.limited ? 429 : 500,
                message: "SENSITIVE_SMTP_DIAGNOSTIC",
              }
            : null,
      };
    },
  );
  const signInWithOtp = vi.fn(
    async (_params: {
      email: string;
      options: { shouldCreateUser: boolean; emailRedirectTo: string };
    }) => {
      order.push("otp");
      return {
        error: options.failOtp
          ? {
              code: "unexpected_failure",
              status: 500,
              message: "SENSITIVE_SMTP_DIAGNOSTIC",
            }
          : null,
      };
    },
  );
  const client = {
    rpc,
    auth: {
      getUser: async () => ({
        error: null,
        data: {
          user: options.invalidSession
            ? null
            : { email_confirmed_at: "2026-11-06" },
        },
      }),
      admin: { inviteUserByEmail },
      signInWithOtp,
    },
  };
  const factory = vi.fn(() => client);
  return {
    request: handler(factory as unknown as typeof createClient),
    rpc,
    inviteUserByEmail,
    signInWithOtp,
    deliveries,
    order,
  };
}
async function checkTicket(s: ReturnType<typeof setup>, redirect: string) {
  const callback = new URL(redirect);
  expect(callback.origin).toBe("https://yangzi831.github.io");
  expect(callback.pathname).toBe("/wing-sound-academy/");
  expect(callback.hash).toBe("");
  expect(callback.searchParams.has("token_hash")).toBe(false);
  const prepared = s.rpc.mock.calls.find(
    ([name]) => name === "academy_prepare_invitation",
  )![1];
  expect(prepared.p_email).toBe("friend@example.com");
  expect(callback.searchParams.get("invitation")).toBe(prepared.p_id);
  const ticket = callback.searchParams.get("ticket")!;
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  expect(prepared.p_hash).toBe(hash);
  expect(prepared.p_hash).not.toBe(ticket);
  return ticket;
}
describe("Supabase Auth SMTP invitations (mocked delivery, no real mail)", () => {
  it("sends a verification invite for a new/unconfirmed user and marks pending only after Auth accepts", async () => {
    const s = setup(),
      r = await s.request();
    expect(r.status).toBe(200);
    expect(s.inviteUserByEmail).toHaveBeenCalledWith("friend@example.com", {
      redirectTo: expect.any(String),
    });
    const ticket = await checkTicket(
      s,
      s.inviteUserByEmail.mock.calls[0][1].redirectTo,
    );
    expect(s.signInWithOtp).not.toHaveBeenCalled();
    expect(s.order).toEqual([
      "academy_prepare_invitation",
      "invite",
      "academy_invitation_delivery",
    ]);
    expect(s.deliveries).toEqual([expect.objectContaining({ p_ok: true })]);
    expect(JSON.stringify(await r.json())).not.toContain(ticket);
  });
  it.each([false, true])(
    "existing account gets a real Auth login email without registering a duplicate (legacy=%s)",
    async (legacyError) => {
      const s = setup({ existing: true, legacyError }),
        r = await s.request();
      expect(r.status).toBe(200);
      const params = s.signInWithOtp.mock.calls[0][0];
      expect(params.email).toBe("friend@example.com");
      expect(params.options.shouldCreateUser).toBe(false);
      expect(params.options.emailRedirectTo).toBe(
        s.inviteUserByEmail.mock.calls[0][1].redirectTo,
      );
      await checkTicket(s, params.options.emailRedirectTo);
      expect(s.order).toEqual([
        "academy_prepare_invitation",
        "invite",
        "otp",
        "academy_invitation_delivery",
      ]);
    },
  );
  it.each([
    { failMail: true },
    { existing: true, failOtp: true },
    { failMail: true, limited: true },
  ])(
    "records Auth SMTP failures for retry; no false success or raw SMTP diagnostics (%j)",
    async (options) => {
      const s = setup(options),
        r = await s.request();
      expect(r.status).toBe(502);
      expect(await r.text()).not.toContain("SENSITIVE_SMTP_DIAGNOSTIC");
      expect(s.deliveries).toEqual([expect.objectContaining({ p_ok: false })]);
      if (!options.existing) expect(s.signInWithOtp).not.toHaveBeenCalled();
    },
  );
  it("does not report sent if the delivery status transaction fails", async () => {
    const s = setup({ failDelivery: true }),
      r = await s.request();
    expect(r.status).toBe(502);
    expect(s.deliveries).toEqual([
      expect.objectContaining({ p_ok: true }),
      expect.objectContaining({ p_ok: false }),
    ]);
  });
  it("rejects nonadmins, invalid sessions, missing authorization and foreign origins before mailing", async () => {
    for (const [options, status] of [
      [{ deny: true }, 403],
      [{ invalidSession: true }, 401],
    ] as const) {
      const s = setup(options);
      expect((await s.request()).status).toBe(status);
      expect(s.inviteUserByEmail).not.toHaveBeenCalled();
      expect(s.signInWithOtp).not.toHaveBeenCalled();
    }
    for (const headers of [
      {
        Origin: "https://untrusted.example",
        Authorization: "Bearer TEST_USER_SESSION",
      },
      {},
    ]) {
      const s = setup();
      expect([401, 403]).toContain((await s.request(headers)).status);
      expect(s.inviteUserByEmail).not.toHaveBeenCalled();
    }
  });
  it("generates fresh tickets on resend while keeping ticket hashes server-side", async () => {
    const s = setup();
    await s.request();
    await s.request();
    expect(s.inviteUserByEmail.mock.calls[0][1].redirectTo).not.toBe(
      s.inviteUserByEmail.mock.calls[1][1].redirectTo,
    );
  });
  it.each([false, true])(
    "real SDK puts both invitation parameters inside redirect_to for SMTP endpoints (existing=%s)",
    async (existing) => {
      const requests: {
        url: URL;
        headers: Headers;
        body: Record<string, unknown>;
      }[] = [];
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          requests.push({
            url,
            headers: new Headers(init?.headers),
            body: JSON.parse(String(init?.body || "{}")),
          });
          if (url.pathname.endsWith("/user"))
            return new Response(
              JSON.stringify({
                id: crypto.randomUUID(),
                email: "owner@example.com",
                email_confirmed_at: "2026-11-06",
              }),
            );
          if (url.pathname.endsWith("/invite") && existing)
            return new Response(
              JSON.stringify({
                code: "email_exists",
                msg: "A user with this email address has already been registered",
              }),
              { status: 422 },
            );
          return new Response(
            JSON.stringify(
              url.pathname.endsWith("/invite")
                ? { id: crypto.randomUUID(), email: "friend@example.com" }
                : {},
            ),
          );
        },
      );
      const factory: typeof createClient = (url, key, options) =>
        createClient(url, key, {
          ...options,
          global: { ...options?.global, fetch: fetchMock },
        });
      const r = await handler(factory)();
      expect(r.status).toBe(200);
      const invite = requests.find((x) => x.url.pathname.endsWith("/invite"))!;
      expect(invite.headers.get("Authorization")).toBe(
        "Bearer TEST_SERVER_ONLY",
      );
      const redirect = invite.url.searchParams.get("redirect_to")!;
      expect(new URL(redirect).searchParams.get("ticket")).toMatch(
        /^[0-9a-f]{64}$/,
      );
      expect(new URL(redirect).searchParams.get("invitation")).toBeTruthy();
      expect(invite.body.email).toBe("friend@example.com");
      expect(invite.body).not.toHaveProperty("email_confirm");
      const otp = requests.find((x) => x.url.pathname.endsWith("/otp"));
      if (existing) {
        expect(otp?.url.searchParams.get("redirect_to")).toBe(redirect);
        expect(otp?.body.create_user).toBe(false);
        expect(otp?.headers.get("Authorization")).toBe("Bearer TEST_PUBLIC");
        expect(otp?.body.code_challenge).toBeNull(); // Cross-device link, not server-bound PKCE.
      } else expect(otp).toBeUndefined();
      expect(requests.every((x) => x.url.host === "example.supabase.co")).toBe(
        true,
      );
    },
  );
});
