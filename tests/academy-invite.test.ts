import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";
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
function setup(
  options: {
    existing?: boolean;
    failMail?: boolean;
    deny?: boolean;
    invalidSession?: boolean;
    unconfigured?: boolean;
  } = {},
) {
  const deliveries: unknown[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "academy_prepare_invitation" && options.deny)
      return { error: { code: "42501", message: "Admin required" } };
    if (name === "academy_invitation_delivery") deliveries.push(args);
    return { error: null };
  });
  const generateLink = vi.fn(async (p: { type: string }) =>
    options.existing && p.type === "invite"
      ? { error: { message: "User already registered" }, data: {} }
      : {
          error: null,
          data: {
            properties: {
              hashed_token: "TEST_EMAIL_VERIFICATION_HASH",
              verification_type: p.type === "invite" ? "invite" : "magiclink",
            },
          },
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
      admin: { generateLink },
    },
  };
  const env: Record<string, string> = {
    SITE_URL: "https://yangzi831.github.io/wing-sound-academy/",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "TEST_SERVER_ONLY",
    SUPABASE_ANON_KEY: "TEST_PUBLIC",
    RESEND_API_KEY: "TEST_EMAIL_PROVIDER",
    INVITE_FROM: "Academy <test@example.com>",
  };
  if (options.unconfigured) delete env.RESEND_API_KEY;
  const fetchMock = vi.fn(
    async () => new Response("{}", { status: options.failMail ? 429 : 200 }),
  );
  let handle: (req: Request) => Promise<Response>;
  new Function("createClient", "Deno", "fetch", compiled)(
    () => client,
    {
      env: { get: (key: string) => env[key] },
      serve: (fn: typeof handle) => {
        handle = fn;
      },
    },
    fetchMock,
  );
  const request = (
    headers: Record<string, string> = {
      Authorization: "Bearer TEST_USER_SESSION",
    },
  ) =>
    handle(
      new Request("https://example.supabase.co/functions/v1/academy-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          academyId: "test-academy",
          email: "Friend@Example.com",
        }),
      }),
    );
  return { request, fetchMock, rpc, generateLink, deliveries };
}
describe("invitation Edge Function with mocked Auth/email boundaries (no real email)", () => {
  it("only marks pending after provider acceptance; emails a hashed verification callback and stores only a ticket hash", async () => {
    const s = setup(),
      r = await s.request();
    expect(r.status).toBe(200);
    const prepared = s.rpc.mock.calls.find(
      ([name]) => name === "academy_prepare_invitation",
    )![1];
    expect(prepared.p_email).toBe("friend@example.com");
    const mail = JSON.parse(s.fetchMock.mock.calls[0][1].body);
    const match = mail.text.match(/https:\/\/[^\s]+/)!;
    const callback = new URL(match[0]);
    expect(callback.origin).toBe("https://yangzi831.github.io");
    expect(callback.pathname).toBe("/wing-sound-academy/");
    expect(callback.searchParams.get("type")).toBe("invite");
    const ticket = callback.searchParams.get("ticket")!;
    const hashed = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    expect(prepared.p_hash).toBe(hashed);
    expect(prepared.p_hash).not.toBe(ticket);
    expect(JSON.stringify(await r.json())).not.toContain(
      "TEST_EMAIL_VERIFICATION_HASH",
    );
    expect(s.deliveries).toEqual([expect.objectContaining({ p_ok: true })]);
  });
  it("uses an existing account magic link and preserves mail failures for retry instead of reporting success", async () => {
    const s = setup({ existing: true, failMail: true }),
      r = await s.request();
    expect(s.generateLink.mock.calls.map(([p]) => p.type)).toEqual([
      "invite",
      "magiclink",
    ]);
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual(
      expect.objectContaining({ error: expect.stringContaining("429") }),
    );
    expect(s.deliveries).toEqual([expect.objectContaining({ p_ok: false })]);
  });
  it("rejects nonadmins, invalid sessions, foreign origins and missing email configuration without sending", async () => {
    for (const [options, status] of [
      [{ deny: true }, 403],
      [{ invalidSession: true }, 401],
      [{ unconfigured: true }, 503],
    ] as const) {
      const s = setup(options);
      expect((await s.request()).status).toBe(status);
      expect(s.fetchMock).not.toHaveBeenCalled();
    }
    const s = setup();
    expect(
      (
        await s.request({
          Origin: "https://untrusted.example",
          Authorization: "Bearer TEST_USER_SESSION",
        })
      ).status,
    ).toBe(403);
    expect(s.fetchMock).not.toHaveBeenCalled();
  });
});
