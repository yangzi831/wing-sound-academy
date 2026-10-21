import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const owner = "11111111-1111-4111-8111-111111111111",
  stranger = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
async function login(uid: string, role = "authenticated") {
  await db.exec(
    `reset role; set role ${role}; select set_config('request.jwt.claim.sub','${uid}',false); select set_config('request.jwt.claims','{}',false);`,
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth,storage to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id bigserial primary key,bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to anon,authenticated;
    grant usage on sequence storage.objects_id_seq to anon,authenticated;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    insert into auth.users values('${owner}',now()),('${stranger}',now());
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202610210001_studio_sync.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`insert into public.studio_owners values('${owner}')`);
}, 30000);
afterAll(async () => await db?.close());
describe("PostgreSQL RLS, CAS and private audio policies", () => {
  it("owner-only writes, RLS reads, append-only revisions and optimistic concurrency", async () => {
    await login(owner);
    const first = await db.query<{
      r: { ok: boolean; row: { revision: number } };
    }>(`select studio_write('semester','main','{"title":"first"}',0) r`);
    expect(first.rows[0].r.row.revision).toBe(1);
    const stale = await db.query<{
      r: { ok: boolean; row: { payload: { title: string } } };
    }>(`select studio_write('semester','main','{"title":"stale"}',0) r`);
    expect(stale.rows[0].r.ok).toBe(false);
    expect(stale.rows[0].r.row.payload.title).toBe("first");
    await expect(
      db.exec(`update studio_records set revision=50`),
    ).rejects.toThrow("permission denied");
    await expect(db.exec(`delete from studio_history`)).rejects.toThrow(
      "permission denied",
    );
    await db.exec(
      `select studio_write('semester','main','{"title":"second"}',1)`,
    );
    expect((await db.query("select * from studio_history")).rows).toHaveLength(
      2,
    );
    await login(stranger);
    expect((await db.query("select * from studio_records")).rows).toHaveLength(
      0,
    );
    expect((await db.query("select * from studio_history")).rows).toHaveLength(
      0,
    );
    await expect(
      db.exec(`select studio_write('semester','main','{}',0)`),
    ).rejects.toThrow("verified studio owner");
    await expect(db.exec("select studio_snapshot()")).rejects.toThrow(
      "verified studio owner",
    );
    await login("", "anon");
    await expect(db.exec("select studio_snapshot()")).rejects.toThrow(
      "permission denied",
    );
  });
  it("unverified and anonymous users cannot use owner permissions", async () => {
    await db.exec("reset role");
    await db.exec(
      `update auth.users set email_confirmed_at=null where id='${owner}'`,
    );
    await login(owner);
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select studio_authorized() allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
    await db.exec("reset role");
    await db.exec(
      `update auth.users set email_confirmed_at=now() where id='${owner}'`,
    );
    await login(owner);
    await db.exec(
      `select set_config('request.jwt.claims','{"is_anonymous":true}',false)`,
    );
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select studio_authorized() allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
  it("private bucket rejects stranger and public access, owner cannot upload into foreign folder", async () => {
    await login(owner);
    await db.exec(
      `insert into storage.objects(bucket_id,name) values('studio-audio','${owner}/demo')`,
    );
    await expect(
      db.exec(
        `insert into storage.objects(bucket_id,name) values('studio-audio','${stranger}/demo')`,
      ),
    ).rejects.toThrow("row-level security");
    await login(stranger);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
    await expect(
      db.exec(
        `insert into storage.objects(bucket_id,name) values('studio-audio','${stranger}/demo')`,
      ),
    ).rejects.toThrow("row-level security");
    await login("", "anon");
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
    await db.exec("reset role");
    const bucket = await db.query<{ public: boolean; file_size_limit: number }>(
      "select * from storage.buckets",
    );
    expect(bucket.rows[0].public).toBe(false);
    expect(bucket.rows[0].file_size_limit).toBe(45 * 1024 * 1024);
    await login(owner);
    await db.exec(`delete from storage.objects where name='${owner}/demo'`);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
  });
  it("removing an audio version atomically clears review links and preserves review content/history", async () => {
    await login(owner);
    await db.exec(
      `select studio_write('artifact','a1','{"id":"a1","kind":"音频版本","projectId":"P00"}',0)`,
    );
    await db.exec(
      `select studio_write('critique','c1','{"id":"c1","projectId":"P00","versionId":"a1","issues":"01:24 bass"}',0)`,
    );
    await db.exec(`select studio_write('artifact','a1',null,1)`);
    const review = await db.query<{
      payload: { versionId: string; issues: string };
      revision: number;
    }>(
      `select payload,revision from studio_records where kind='critique' and id='c1'`,
    );
    expect(review.rows[0].payload.versionId).toBe("");
    expect(review.rows[0].payload.issues).toBe("01:24 bass");
    expect(review.rows[0].revision).toBe(2);
    expect(
      (
        await db.query(
          `select * from studio_history where kind='critique' and id='c1'`,
        )
      ).rows,
    ).toHaveLength(2);
    await expect(
      db.exec(
        `select studio_write('critique','c2','{"id":"c2","versionId":"a1","projectId":"P00"}',0)`,
      ),
    ).rejects.toThrow("Linked audio version");
  });
  it("currently referenced audio cannot be deleted; deleted files cannot be linked by historical metadata", async () => {
    await login(owner);
    await db.exec(
      `insert into storage.objects(bucket_id,name) values('studio-audio','${owner}/active-file')`,
    );
    const payload = JSON.stringify({
      id: "active-audio",
      kind: "音频版本",
      projectId: "P00",
      fileId: "active-file",
      remotePath: `${owner}/active-file`,
    });
    await db.query(
      `select studio_write('artifact','active-audio',$1::jsonb,0)`,
      [payload],
    );
    await db.exec(
      `delete from storage.objects where name='${owner}/active-file'`,
    );
    expect(
      (
        await db.query(
          `select * from storage.objects where name='${owner}/active-file'`,
        )
      ).rows,
    ).toHaveLength(1);
    await db.exec(
      `select studio_write('artifact','active-audio',null,1);delete from storage.objects where name='${owner}/active-file'`,
    );
    expect(
      (
        await db.query(
          `select * from storage.objects where name='${owner}/active-file'`,
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      db.query(`select studio_write('artifact','active-audio',$1::jsonb,2)`, [
        payload,
      ]),
    ).rejects.toThrow("Private audio is missing");
  });
});
