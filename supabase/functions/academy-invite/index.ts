import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const origin =
  Deno.env.get("SITE_URL") || "https://yangzi831.github.io/wing-sound-academy/";
const site = new URL(origin);
const cors = {
  "Access-Control-Allow-Origin": site.origin,
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const digest = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST required" });
  const requestOrigin = req.headers.get("Origin");
  if (requestOrigin && requestOrigin !== site.origin)
    return json(403, { error: "Origin rejected" });
  const url = Deno.env.get("SUPABASE_URL")!,
    serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer "))
    return json(401, { error: "Sign in required" });
  const userClient = createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user?.email_confirmed_at)
    return json(401, { error: "Verified session required" });
  let invitationId: string | undefined;
  try {
    const body = await req.json();
    const academy = body.academyId;
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    if (typeof academy !== "string" || !email || email.length > 254)
      return json(400, { error: "请填写学院和有效邮箱" });
    const ticket = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    invitationId = crypto.randomUUID();
    // This RPC authorizes the caller, reserves the delivery attempt, rotates tickets and rate-limits resends.
    const { error: reserveError } = await userClient.rpc(
      "academy_prepare_invitation",
      {
        p_academy: academy,
        p_email: email,
        p_id: invitationId,
        p_hash: await digest(ticket),
      },
    );
    if (reserveError) {
      invitationId = undefined;
      return json(reserveError.code === "42501" ? 403 : 409, {
        error: reserveError.message,
      });
    }
    const callback = new URL(site.href);
    callback.hash = "";
    callback.searchParams.set("invitation", invitationId);
    callback.searchParams.set("ticket", ticket);
    // Auth sends through the project's SMTP. No SMTP password or external mail key
    // is read by this function, and no user is marked email_confirmed here.
    let { error: mailError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: callback.href,
    });
    const existingAccount =
      mailError &&
      (["email_exists", "user_already_exists"].includes(mailError.code || "") ||
        (!mailError.code &&
          mailError.status === 422 &&
          mailError.message ===
            "A user with this email address has already been registered"));
    if (existingAccount) {
      // A separate, sessionless client sends an existing-account login email.
      // Unlike an admin-generated link, this endpoint actually sends via Auth SMTP.
      const loginClient = createClient(url, publicKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          flowType: "implicit",
        },
      });
      ({ error: mailError } = await loginClient.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: callback.href },
      }));
    }
    if (mailError) {
      const limited =
        mailError.status === 429 || mailError.code?.startsWith("over_");
      throw new Error(
        limited
          ? "Supabase Auth 发信频率受限，请稍后重发，并检查 Authentication → Rate Limits。"
          : "Supabase Auth 邮件发送失败，请检查后台 SMTP 配置和 Auth Logs；Gmail 需使用应用专用密码。",
      );
    }
    const { error: deliveryError } = await admin.rpc(
      "academy_invitation_delivery",
      { p_id: invitationId, p_ok: true, p_error: null },
    );
    if (deliveryError)
      throw new Error(
        "Auth 邮件已提交，但邀请状态未能确认，请稍后重新发送新邀请",
      );
    return json(200, { sent: true, id: invitationId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "邀请失败，请重试";
    if (invitationId)
      await admin.rpc("academy_invitation_delivery", {
        p_id: invitationId,
        p_ok: false,
        p_error: message,
      });
    // Never log or return the service key, auth verification token or invitation ticket.
    return json(502, { error: message });
  }
});
