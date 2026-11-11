import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const owner = "11111111-1111-4111-8111-111111111111",
  friend = "22222222-2222-4222-8222-222222222222",
  nextUser = "33333333-3333-4333-8333-333333333333",
  unverified = "44444444-4444-4444-8444-444444444444",
  later = "55555555-5555-4555-8555-555555555555";
let db: PGlite, aid: string;
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611110001_open_registration.sql",
    import.meta.url,
  ),
  "utf8",
);
async function login(uid: string, role = "authenticated", claims = {}) {
  await db.exec(
    `reset role;set role ${role};select set_config('request.jwt.claim.sub','${uid}',false);`,
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify(claims),
  ]);
}
async function rpc<T = unknown>(name: string, args: unknown[] = []) {
  return (
    await db.query<{ value: T }>(
      `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`,
      args,
    )
  ).rows[0].value;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth,storage to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id bigserial primary key,bucket_id text,name text);alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to anon,authenticated;grant usage on sequence storage.objects_id_seq to anon,authenticated;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    insert into auth.users values('${owner}','owner@example.com',now()),('${friend}','friend@example.com',now()),
      ('${nextUser}','next@example.com',now()),('${unverified}','unverified@example.com',null),('${later}','later@example.com',now());`);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202610210001_studio_sync.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`insert into studio_owners values('${owner}')`);
  await login(owner);
  await rpc("studio_write", [
    "session",
    "W01",
    JSON.stringify({
      id: "W01",
      notes: "original owner note",
      status: "进行中",
    }),
    0,
  ]);
  await db.exec(`insert into storage.objects(bucket_id,name) values('studio-audio','${owner}/demo');`);
  await rpc("studio_write", [
    "artifact",
    "demo",
    JSON.stringify({
      id: "demo",
      title: "Original Demo",
      projectId: "P00",
      remotePath: `${owner}/demo`,
      fileId: "demo",
    }),
    0,
  ]);
  await db.exec("reset role;");
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611060001_academy.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(migration);
  await login(owner);
  aid = (await rpc<{ id: string }[]>("academy_index"))[0].id;
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("open registration to the existing shared academy", () => {
  it("requires confirmed email and rejects anonymous accounts and callers", async () => {
    await login(unverified);
    await expect(rpc("academy_join_shared")).rejects.toThrow("验证邮箱");
    expect(await rpc("academy_index")).toEqual([]);
    expect(
      (await db.query("select * from academy_documents")).rows,
    ).toHaveLength(0);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
    await login(friend, "authenticated", { is_anonymous: true });
    await expect(rpc("academy_join_shared")).rejects.toThrow("验证邮箱");
    await login("", "anon");
    await expect(rpc("academy_join_shared")).rejects.toThrow(
      "permission denied",
    );
  });
  it("joins a verified user without a ticket, twice safely, with empty personal records", async () => {
    await login(friend, "authenticated", {
      email: "spoof@example.com",
      role: "admin",
    });
    expect(await rpc("academy_join_shared")).toBe(aid);
    expect(await rpc("academy_join_shared")).toBe(aid);
    const s = await rpc<{
      members: { user_id: string; display_name: string; role: string }[];
      documents: {
        author_id: string | null;
        payload: Record<string, unknown>;
        kind: string;
      }[];
    }>("academy_snapshot", [aid]);
    expect(s.members).toHaveLength(2);
    expect(s.members.find((m) => m.user_id === friend)).toMatchObject({
      role: "member",
      display_name: "friend@example.com",
    });
    expect(s.documents.filter((d) => d.author_id === friend)).toEqual([]);
    expect(
      s.documents.find((d) => d.payload.notes === "original owner note")
        ?.author_id,
    ).toBe(owner);
    expect(s.documents.filter((d) => d.kind === "course")).toHaveLength(3);
    expect(s.documents.filter((d) => d.kind === "lesson")).toHaveLength(16);
    expect(s.documents.filter((d) => d.kind === "project")).toHaveLength(5);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      1,
    );
  });
  it("any further verified registrant joins that same academy and sees shared notes and private audio", async () => {
    await login(nextUser);
    expect(await rpc("academy_index")).toEqual([]);
    expect(await rpc("academy_join_shared")).toBe(aid);
    expect((await rpc<{ id: string }[]>("academy_index"))[0].id).toBe(aid);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      1,
    );
    await expect(
      rpc("academy_write", [
        aid,
        `week/electronic/${owner}/W01`,
        "electronic",
        "week",
        owner,
        JSON.stringify({ notes: "overwrite owner" }),
        1,
      ]),
    ).rejects.toThrow();
    const note = await rpc<{ ok: boolean }>("academy_write", [
      aid,
      `note/keyboard/${nextUser}/own`,
      "keyboard",
      "note",
      nextUser,
      JSON.stringify({ body: "my own practice" }),
      0,
    ]);
    expect(note.ok).toBe(true);
    await login(friend);
    const s = await rpc<{
      documents: { author_id: string; payload: Record<string, unknown> }[];
    }>("academy_snapshot", [aid]);
    expect(
      s.documents.find((d) => d.payload.body === "my own practice")?.author_id,
    ).toBe(nextUser);
  });
  it("does not grant admin access, change curriculum, or permit direct membership/configuration writes", async () => {
    await expect(
      db.exec("update academy_registration set enabled=false"),
    ).rejects.toThrow("permission denied");
    await expect(
      db.exec("update academy_members set role='admin'"),
    ).rejects.toThrow("permission denied");
    await expect(rpc("academy_remove_member", [aid, owner])).rejects.toThrow(
      "Admin",
    );
    await expect(
      rpc("academy_write", [
        aid,
        "lesson/electronic/W01",
        "electronic",
        "lesson",
        null,
        "{}",
        1,
      ]),
    ).rejects.toThrow("fixed");
  });
  it("keeps removal effective for existing sessions and self-enrollment retries", async () => {
    await login(owner);
    await rpc("academy_remove_member", [aid, nextUser]);
    await login(nextUser);
    await expect(rpc("academy_join_shared")).rejects.toThrow("权限已移除");
    expect(await rpc("academy_index")).toEqual([]);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
    await login(owner);
    const s = await rpc<{
      documents: { author_id: string; payload: Record<string, unknown> }[];
    }>("academy_snapshot", [aid]);
    expect(
      s.documents.find((d) => d.payload.body === "my own practice")?.author_id,
    ).toBe(nextUser);
    expect(await rpc("academy_join_shared")).toBe(aid);
    expect((await rpc<{ role: string }[]>("academy_index"))[0].role).toBe(
      "admin",
    );
  });
  it("can stop automatic enrollment without preventing existing members from using the academy", async () => {
    await db.exec("reset role;update academy_registration set enabled=false;");
    await login(later);
    await expect(rpc("academy_join_shared")).rejects.toThrow("暂未开放");
    await login(friend);
    expect(await rpc("academy_join_shared")).toBe(aid);
    await db.exec("reset role;update academy_registration set enabled=true;");
  });
  it("is retryable without re-seeding courses, author records or membership", async () => {
    await db.exec("reset role;");
    const before = (
      await db.query(
        "select (select count(*) from academy_members) members,(select count(*) from academy_documents) documents,(select count(*) from academy_history) history",
      )
    ).rows;
    await db.exec(migration);
    expect(
      (
        await db.query(
          "select (select count(*) from academy_members) members,(select count(*) from academy_documents) documents,(select count(*) from academy_history) history",
        )
      ).rows,
    ).toEqual(before);
    await login(later);
    expect(await rpc("academy_join_shared")).toBe(aid);
  });
});
