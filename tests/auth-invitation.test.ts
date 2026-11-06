import { describe, it, expect, vi } from "vitest";
import {
  finishInvitation,
  invitationRedirect,
  pendingInvitationKey,
  readPendingInvitation,
} from "../src/auth-invitation";
const invitation = "12345678-1234-4234-8234-123456789012",
  ticket = "a".repeat(64),
  base = "https://yangzi831.github.io/wing-sound-academy/";
function browser(href: string) {
  const memory = new Map<string, string>(),
    events: string[] = [],
    location = { href };
  const storage = {
    getItem: (key: string) => memory.get(key) || null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
      events.push("stored");
    },
  };
  const history = {
    state: { test: true },
    replaceState: vi.fn(
      (_state: unknown, _unused: string, value?: string | URL | null) => {
        events.push("scrubbed");
        location.href = new URL(String(value), location.href).href;
      },
    ),
  };
  return { location, storage, history, events };
}
function callback(hash = "") {
  return `${base}?invitation=${invitation}&ticket=${ticket}${hash}`;
}
describe("invitation login callback and follow-up login redirect", () => {
  it.each(["invite", "magiclink"])(
    "keeps parameters until SDK consumes the %s login fragment",
    async (type) => {
      const b = browser(
        callback(
          `#access_token=TEST_ACCESS&refresh_token=TEST_REFRESH&type=${type}`,
        ),
      );
      const auth = {
        getSession: vi.fn(async () => {
          expect(readPendingInvitation(b.storage)).toEqual({
            invitation,
            ticket,
          });
          expect(b.location.href).toContain("access_token=TEST_ACCESS");
          expect(b.history.replaceState).not.toHaveBeenCalled();
          b.events.push("SDK read tokens");
          await Promise.resolve();
          b.location.href = b.location.href.split("#")[0]; // Real SDK clears the consumed fragment.
          return {
            data: { session: { user: { id: "invited-user" } } },
            error: null,
          };
        }),
        verifyOtp: vi.fn(),
      };
      await finishInvitation(auth, b);
      expect(b.events).toEqual(["stored", "SDK read tokens", "scrubbed"]);
      expect(b.location.href).toBe(base);
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      expect(readPendingInvitation(b.storage)).toEqual({ invitation, ticket });
    },
  );
  it("keeps the invitation through failed/expired login and forwards it into the next OTP/Magic Link email", async () => {
    const b = browser(callback("#error=access_denied&error_code=otp_expired"));
    await expect(
      finishInvitation(
        {
          getSession: async () => ({
            data: { session: null },
            error: new Error("expired"),
          }),
          verifyOtp: vi.fn(),
        },
        b,
      ),
    ).rejects.toThrow("同一受邀邮箱");
    expect(b.location.href).toBe(base);
    const next = invitationRedirect(base, b.storage);
    expect(new URL(next).searchParams.get("invitation")).toBe(invitation);
    expect(new URL(next).searchParams.get("ticket")).toBe(ticket);
    const otherTab = browser(
      next +
        "#access_token=TEST_FRESH&refresh_token=TEST_FRESH_REFRESH&type=magiclink",
    );
    await finishInvitation(
      {
        getSession: async () => ({
          data: { session: { user: { id: "invited-user" } } },
          error: null,
        }),
        verifyOtp: vi.fn(),
      },
      otherTab,
    );
    expect(readPendingInvitation(otherTab.storage)).toEqual({
      invitation,
      ticket,
    });
    expect(otherTab.location.href).toBe(base);
  });
  it("rejects a callback when SDK initialization failed without returning a session error", async () => {
    const b = browser(
      callback("#access_token=INVALID&refresh_token=INVALID&type=invite"),
    );
    await expect(
      finishInvitation(
        {
          getSession: async () => ({ data: { session: null }, error: null }),
          verifyOtp: vi.fn(),
        },
        b,
      ),
    ).rejects.toThrow("同一受邀邮箱");
    expect(b.location.href).toBe(base);
    expect(readPendingInvitation(b.storage)).toEqual({ invitation, ticket });
  });
  it.each(["invite", "magiclink"] as const)(
    "accepts old token_hash emails (%s) without changing their verification semantics",
    async (type) => {
      const b = browser(
          callback() + `&token_hash=TEST_LEGACY_HASH&type=${type}`,
        ),
        auth = {
          getSession: vi.fn(),
          verifyOtp: vi.fn(async () => ({ error: null })),
        };
      await finishInvitation(auth, b);
      expect(auth.verifyOtp).toHaveBeenCalledWith({
        token_hash: "TEST_LEGACY_HASH",
        type,
      });
      expect(auth.getSession).not.toHaveBeenCalled();
      expect(b.location.href).toBe(base);
    },
  );
  it("preserves pending tickets when verification throws and preserves unrelated route parameters", async () => {
    const b = browser(callback() + "&course=keyboard#overview");
    await expect(
      finishInvitation(
        {
          getSession: async () => {
            throw new Error("network failure");
          },
          verifyOtp: vi.fn(),
        },
        b,
      ),
    ).rejects.toThrow("network failure");
    expect(b.location.href).toBe(base + "?course=keyboard#overview");
    expect(readPendingInvitation(b.storage)).toEqual({ invitation, ticket });
  });
  it("does not manufacture tickets or replace a valid pending invitation with an incomplete URL", async () => {
    const b = browser(base),
      auth = { getSession: vi.fn(), verifyOtp: vi.fn() };
    expect(invitationRedirect(base, b.storage)).toBe(base);
    b.storage.setItem(pendingInvitationKey, "not json");
    expect(readPendingInvitation(b.storage)).toBeNull();
    b.storage.setItem(
      pendingInvitationKey,
      JSON.stringify({ invitation, ticket }),
    );
    b.location.href = base + "?invitation=" + invitation;
    await expect(finishInvitation(auth, b)).rejects.toThrow("不完整");
    expect(readPendingInvitation(b.storage)).toEqual({ invitation, ticket });
    expect(auth.getSession).not.toHaveBeenCalled();
  });
});
