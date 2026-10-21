import { createClient } from "@supabase/supabase-js";

const env = import.meta.env;
const url = env.VITE_SUPABASE_URL?.trim();
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const cloudConfigured = Boolean(
  url &&
  /^https:\/\/[a-z0-9.-]+$/.test(url) &&
  key?.startsWith("sb_publishable_"),
);
export const supabase = cloudConfigured
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "implicit",
      },
      global: {
        fetch: (input, init) => {
          const target =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          const timeout = AbortSignal.timeout(
            target.includes("/storage/v1/") ? 180000 : 15000,
          );
          return fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, timeout])
              : timeout,
          });
        },
      },
    })
  : null;
// No hash route in callback: Supabase consumes the auth hash before App mounts.
export const authCallback = () => location.origin + location.pathname;
