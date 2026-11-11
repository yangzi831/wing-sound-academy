import type { SupabaseClient } from "@supabase/supabase-js";

// Registration and sign-in share an email OTP / Magic Link flow. Only the
// academy entry may create an account; the legacy personal studio stays closed.
export async function requestEmailAccess(
  auth: Pick<SupabaseClient["auth"], "signInWithOtp">,
  email: string,
  academy: boolean,
  redirectTo: string,
) {
  const { error } = await auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: academy, emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

export function emailAccessError(error: unknown) {
  const e = error as { code?: string; message?: string; status?: number };
  if (
    ["signup_disabled", "otp_disabled"].includes(e?.code || "") ||
    /signups not allowed/i.test(e?.message || "")
  )
    return "注册尚未在 Supabase 后台开放，请管理员开启 Allow new users to sign up；邮箱确认应保持开启。";
  if (e?.status === 429 || e?.code?.startsWith("over_"))
    return "发送频率受限，请稍后再试，并检查垃圾邮件。";
  if (["otp_expired", "access_denied"].includes(e?.code || ""))
    return "验证码或邮件链接已失效，请重新发送并使用最新一封邮件。";
  return e?.message || "邮箱验证失败，请稍后重试。";
}
