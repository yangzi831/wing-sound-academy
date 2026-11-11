export const pendingInvitationKey = "wing-pending-invitation";
type Invitation = { invitation: string; ticket: string };
type InvitationStorage = Pick<Storage, "getItem" | "setItem">;

function isInvitation(value: unknown): value is Invitation {
  const p = value as Invitation | null;
  return (
    !!p &&
    typeof p.invitation === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      p.invitation,
    ) &&
    typeof p.ticket === "string" &&
    /^[0-9a-f]{64}$/.test(p.ticket)
  );
}

export function readPendingInvitation(
  storage: Pick<Storage, "getItem">,
): Invitation | null {
  try {
    const p: unknown = JSON.parse(
      storage.getItem(pendingInvitationKey) || "null",
    );
    return isInvitation(p) ? p : null;
  } catch {
    return null;
  }
}

// Keep the invitation when an expired link is followed by an OTP/Magic Link login,
// including when that subsequent email is opened in a different browser tab.
export function invitationRedirect(
  base: string,
  storage: Pick<Storage, "getItem">,
) {
  const url = new URL(base),
    pending = readPendingInvitation(storage);
  if (pending) {
    url.searchParams.set("invitation", pending.invitation);
    url.searchParams.set("ticket", pending.ticket);
  }
  return url.href;
}

type InvitationAuth = {
  initialize?(): Promise<{ error: unknown }>;
  getSession(): Promise<{ data: { session: unknown }; error: unknown }>;
  verifyOtp(params: {
    token_hash: string;
    type: "invite" | "magiclink" | "signup" | "email";
  }): Promise<{ error: unknown }>;
};
type CallbackBrowser = {
  location: Pick<Location, "href">;
  history: Pick<History, "state" | "replaceState">;
  storage: InvitationStorage;
};

export async function finishInvitation(
  auth: InvitationAuth,
  browser: CallbackBrowser,
) {
  const incoming = new URL(browser.location.href),
    params = incoming.searchParams;
  const pending = {
    invitation: params.get("invitation"),
    ticket: params.get("ticket"),
  };
  const hasInvitation = !!(pending.invitation || pending.ticket);
  if (hasInvitation && !isInvitation(pending))
    throw new Error("邀请链接不完整，请打开完整邮件链接或请管理员重发。");
  if (hasInvitation)
    browser.storage.setItem(pendingInvitationKey, JSON.stringify(pending));
  const token = params.get("token_hash"),
    type = params.get("type");
  const authHash = new URLSearchParams(incoming.hash.slice(1));
  let cleanUrl =
    hasInvitation ||
    !!token ||
    params.has("error") ||
    ["access_token", "refresh_token", "error", "error_code"].some((k) =>
      authHash.has(k),
    );
  if (!cleanUrl && !auth.initialize) return;
  try {
    // Auth's implicit-flow initialization consumes the callback fragment. Await it
    // before changing the URL; otherwise login tokens can disappear before SDK reads.
    // getSession alone can lose initialization errors once the SDK consumed the
    // fragment. Read its cached initialization result for ordinary signup too.
    let error: unknown = (await auth.initialize?.())?.error;
    if (error) cleanUrl = true;
    if (!cleanUrl) return;
    if (
      token &&
      (type === "invite" ||
        type === "magiclink" ||
        type === "signup" ||
        type === "email")
    ) {
      ({ error } = await auth.verifyOtp({ token_hash: token, type }));
    } else {
      const result = await auth.getSession();
      error ||= result.error;
      // The SDK can preserve an initialization error while getSession returns null
      // without an error. Never treat a failed callback as a completed login.
      if (authHash.has("access_token") && !result.data.session) error = true;
    }
    if (
      error ||
      authHash.has("error") ||
      authHash.has("error_code") ||
      params.has("error")
    )
      throw new Error(
        hasInvitation
          ? "邮箱确认链接已失效或已使用。请用同一受邀邮箱重新发送验证邮件；首次注册需先验证邮箱，也可请管理员重发邀请。"
          : "邮箱验证链接已失效或已使用，或未能建立登录会话。请重新发送验证邮件，使用最新邮件中的验证码或链接。",
      );
  } finally {
    if (cleanUrl) {
      const clean = new URL(browser.location.href);
      for (const key of [
        "invitation",
        "ticket",
        "token_hash",
        "type",
        "error",
        "error_code",
        "error_description",
      ])
        clean.searchParams.delete(key);
      const hash = new URLSearchParams(clean.hash.slice(1));
      if (
        ["access_token", "refresh_token", "error", "error_code"].some((k) =>
          hash.has(k),
        )
      )
        clean.hash = "";
      browser.history.replaceState(
        browser.history.state,
        "",
        clean.pathname + clean.search + clean.hash,
      );
    }
  }
}
