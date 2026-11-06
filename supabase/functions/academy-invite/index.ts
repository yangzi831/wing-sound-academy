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
  const emailKey = Deno.env.get("RESEND_API_KEY"),
    from = Deno.env.get("INVITE_FROM");
  if (!emailKey || !from)
    return json(503, {
      error:
        "邀请邮件服务尚未配置：需要 RESEND_API_KEY 和已验证域名的 INVITE_FROM",
    });
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
    let link = await admin.auth.admin.generateLink({ type: "invite", email });
    if (link.error) {
      // Existing Auth account: email magic link instead of creating a second identity.
      if (/already|registered|exists/i.test(link.error.message))
        link = await admin.auth.admin.generateLink({
          type: "magiclink",
          email,
        });
      else throw new Error("身份邀请生成失败，请检查 Supabase Auth 设置");
    }
    if (link.error || !link.data.properties?.hashed_token)
      throw new Error("登录验证链接生成失败");
    const callback = new URL(site.href);
    callback.searchParams.set("token_hash", link.data.properties.hashed_token);
    callback.searchParams.set(
      "type",
      link.data.properties.verification_type === "invite"
        ? "invite"
        : "magiclink",
    );
    callback.searchParams.set("invitation", invitationId);
    callback.searchParams.set("ticket", ticket);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${emailKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "WING SOUND ACADEMY · 学院成员邀请",
        text: `你收到一份 WING SOUND ACADEMY 学院邀请。\n\n请在7天内打开以下链接验证邮箱并加入学院：\n${callback.href}\n\n学院角色和各门课程的教学角色分别管理。如果你不准备加入，请忽略此邮件。`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `邮件服务拒绝发送（${response.status}），请管理员检查已验证发信域名、额度及服务日志`,
      );
    const { error: deliveryError } = await admin.rpc(
      "academy_invitation_delivery",
      { p_id: invitationId, p_ok: true, p_error: null },
    );
    if (deliveryError)
      throw new Error("邮件已提交，但邀请状态未能确认，请稍后重新发送新邀请");
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
