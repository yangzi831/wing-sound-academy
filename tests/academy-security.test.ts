import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createInitialData } from "../src/data";
const owner = "11111111-1111-4111-8111-111111111111",
  friend = "22222222-2222-4222-8222-222222222222",
  outsider = "33333333-3333-4333-8333-333333333333";
let db: PGlite, aid: string;
async function login(uid: string, role = "authenticated") {
  await db.exec(
    `reset role;set role ${role};select set_config('request.jwt.claim.sub','${uid}',false);select set_config('request.jwt.claims','{}',false);`,
  );
}
async function rpc<T = unknown>(name: string, args: unknown[] = []) {
  const rows = await db.query<{ result: T }>(
    `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
    args,
  );
  return rows.rows[0].result;
}
async function write(
  id: string,
  cid: string,
  kind: string,
  author: string | null,
  p: unknown,
  rev = 0,
) {
  return rpc<{
    ok: boolean;
    row: { revision: number; payload: Record<string, unknown> };
  }>("academy_write", [
    aid,
    id,
    cid,
    kind,
    author,
    p === null ? null : JSON.stringify(p),
    rev,
  ]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth,storage to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id bigserial primary key,bucket_id text,name text);alter table storage.objects enable row level security;
 grant select,insert,delete on storage.objects to anon,authenticated;grant usage on sequence storage.objects_id_seq to anon,authenticated;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 insert into auth.users values('${owner}','owner@example.com',now()),('${friend}','friend@example.com',now()),('${outsider}','outsider@example.com',now());`);
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
  const d = createInitialData();
  d.sessions[0].notes = "existing owner note";
  d.projects[4].stages = [true, true, false, false, false];
  await rpc("studio_write", [
    "semester",
    "main",
    JSON.stringify(d.semester),
    0,
  ]);
  for (const s of d.sessions)
    await rpc("studio_write", ["session", s.id, JSON.stringify(s), 0]);
  for (const p of d.projects)
    await rpc("studio_write", ["project", p.id, JSON.stringify(p), 0]);
  await rpc("studio_write", [
    "session",
    "W01",
    JSON.stringify({ ...d.sessions[0], notes: "latest owner note" }),
    1,
  ]);
  await db.exec(
    `insert into storage.objects(bucket_id,name) values('studio-audio','${owner}/legacy-file')`,
  );
  await rpc("studio_write", [
    "artifact",
    "audio1",
    JSON.stringify({
      id: "audio1",
      projectId: "P00",
      kind: "音频版本",
      title: "legacy demo",
      fileId: "legacy-file",
      remotePath: `${owner}/legacy-file`,
    }),
    0,
  ]);
  await rpc("studio_write", [
    "critique",
    "review1",
    JSON.stringify({
      id: "review1",
      projectId: "P00",
      versionId: "audio1",
      issues: "01:24 keep timecode",
    }),
    0,
  ]);
  await db.exec("reset role");
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611060001_academy.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await login(owner);
  aid = (await rpc<{ id: string }[]>("academy_index"))[0].id;
}, 30000);
afterAll(async () => await db?.close());
describe("incremental academy migration and permissions", () => {
  it("migrates original author, content, versions, audio paths; creates only shared defaults plus empty custom frameworks", async () => {
    const s = await rpc<{
      documents: {
        id: string;
        kind: string;
        author_id: string;
        payload: Record<string, unknown>;
        revision: number;
      }[];
    }>("academy_snapshot", [aid]);
    expect(s.documents.filter((d) => d.kind === "course")).toHaveLength(3);
    expect(s.documents.filter((d) => d.kind === "lesson")).toHaveLength(16);
    expect(s.documents.filter((d) => d.kind === "project")).toHaveLength(5);
    const note = s.documents.find(
      (d) => d.id === `week/electronic/${owner}/W01`,
    )!;
    expect(note.author_id).toBe(owner);
    expect(note.payload.notes).toBe("latest owner note");
    expect(note.revision).toBe(2);
    expect(note.payload.topic).toBeUndefined();
    expect(
      s.documents.find((d) => d.id === "lesson/electronic/W01")!.payload.notes,
    ).toBeUndefined();
    expect(
      (await db.query(`select * from academy_history where id=$1`, [note.id]))
        .rows,
    ).toHaveLength(2);
    expect((await db.query("select * from studio_records")).rows).toHaveLength(
      24,
    );
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      1,
    );
    expect(
      s.documents.find((d) => d.id === `critique/electronic/${owner}/review1`)!
        .payload.issues,
    ).toBe("01:24 keep timecode");
  });
  it("fixed curriculum and legacy mutation APIs reject both direct and RPC requests", async () => {
    await expect(
      write(
        "lesson/electronic/W01",
        "electronic",
        "lesson",
        null,
        { topic: "overwrite" },
        1,
      ),
    ).rejects.toThrow("fixed");
    await expect(
      write(
        "course/electronic",
        "electronic",
        "course",
        null,
        { name: "overwrite" },
        1,
      ),
    ).rejects.toThrow("fixed");
    await expect(
      db.exec(`update academy_documents set payload='{}'`),
    ).rejects.toThrow("permission denied");
    await expect(
      rpc("studio_write", ["session", "W01", "{}", 2]),
    ).rejects.toThrow("upgraded");
  });
  it("uninvited accounts cannot read documents, audio, invitations, or use admin actions", async () => {
    await login(outsider);
    expect(await rpc("academy_index")).toEqual([]);
    expect(
      (await db.query("select * from academy_documents")).rows,
    ).toHaveLength(0);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
    await expect(rpc("academy_snapshot", [aid])).rejects.toThrow("membership");
    await expect(
      rpc("academy_prepare_invitation", [
        aid,
        "friend@example.com",
        crypto.randomUUID(),
        "a".repeat(64),
      ]),
    ).rejects.toThrow("Admin");
  });
  it("invite requires sent state, matching verified email, valid ticket; existing account joins without UID handling", async () => {
    await login(owner);
    const id = crypto.randomUUID(),
      hash = "a".repeat(64);
    await rpc("academy_prepare_invitation", [
      aid,
      "FRIEND@example.com",
      id,
      hash,
    ]);
    await login(friend);
    await expect(rpc("academy_accept_invitation", [id, hash])).rejects.toThrow(
      "delivered",
    );
    await expect(
      rpc("academy_invitation_delivery", [id, true, null]),
    ).rejects.toThrow("permission denied");
    await login("", "service_role");
    await rpc("academy_invitation_delivery", [id, true, null]);
    await login(outsider);
    await expect(rpc("academy_accept_invitation", [id, hash])).rejects.toThrow(
      "invited email",
    );
    await login(friend);
    await expect(
      rpc("academy_accept_invitation", [id, "b".repeat(64)]),
    ).rejects.toThrow("invited email");
    expect(await rpc("academy_accept_invitation", [id, hash])).toBe(aid);
    expect(await rpc("academy_accept_invitation", [id, hash])).toBe(aid);
    const s = await rpc<{
      documents: { author_id: string }[];
      invitations: unknown[];
    }>("academy_snapshot", [aid]);
    expect(s.documents.filter((d) => d.author_id === friend)).toHaveLength(0);
    expect(s.invitations).toEqual([]);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      1,
    );
  });
  it("admin can create fourth course; both accounts edit content and concurrent CAS preserves newer version", async () => {
    await login(owner);
    await write("course/fourth", "fourth", "course", null, {
      name: "第四门课程",
      fixed: false,
      order: 3,
      description: "",
      goals: "",
      archived: false,
      roles: {},
      adminRole: "共同学习者",
      memberRole: "共同学习者",
    });
    await write("lesson-fourth", "fourth", "lesson", null, {
      title: "共同填写",
      content: "owner",
      task: "",
      references: "",
      date: "",
      order: 0,
      archived: false,
    });
    await login(friend);
    const edited = await write(
      "lesson-fourth",
      "fourth",
      "lesson",
      null,
      {
        title: "共同填写",
        content: "friend",
        task: "",
        references: "",
        date: "",
        order: 0,
        archived: false,
      },
      1,
    );
    expect(edited.ok).toBe(true);
    await login(owner);
    const stale = await write(
      "lesson-fourth",
      "fourth",
      "lesson",
      null,
      { title: "stale", content: "losing" },
      1,
    );
    expect(stale.ok).toBe(false);
    expect(stale.row.payload.content).toBe("friend");
  });
  it("two authors have separate learning and works; feedback has its own author; course ownership immutable", async () => {
    await login(owner);
    await write("owner-note", "fourth", "note", owner, {
      title: "owner note",
      body: "keep",
      lessonId: "lesson-fourth",
    });
    await login(friend);
    await write("friend-note", "fourth", "note", friend, {
      title: "friend note",
      body: "own",
      lessonId: "lesson-fourth",
    });
    await write("feedback-friend", "fourth", "feedback", friend, {
      targetId: "owner-note",
      body: "01:24 suggestion",
    });
    await expect(
      write("owner-note", "fourth", "note", owner, { title: "overwrite" }, 1),
    ).rejects.toThrow("author");
    await expect(
      write("owner-note", "keyboard", "note", friend, { title: "move" }, 1),
    ).rejects.toThrow("immutable");
    expect(
      (
        await db.query(
          `select * from academy_documents where kind='note' and payload is not null`,
        )
      ).rows,
    ).toHaveLength(2);
  });
  it("members edit shared course goals without gaining course management; note associations stay in their course", async () => {
    await login(friend);
    const course = (
      await db.query<{ payload: Record<string, unknown>; revision: number }>(
        "select payload,revision from academy_documents where id='course/keyboard'",
      )
    ).rows[0];
    const updated = await write(
      "course/keyboard",
      "keyboard",
      "course",
      null,
      { ...course.payload, goals: "共同填写目标" },
      course.revision,
    );
    expect(updated.ok).toBe(true);
    await expect(
      write(
        "course/keyboard",
        "keyboard",
        "course",
        null,
        { ...updated.row.payload, archived: true },
        updated.row.revision,
      ),
    ).rejects.toThrow("admins");
    await expect(
      write("bad-association", "fourth", "note", friend, {
        title: "cross-course",
        lessonId: "lesson/electronic/W01",
      }),
    ).rejects.toThrow("this course");
    await expect(
      write("bad-project", "keyboard", "note", friend, {
        title: "cross-course",
        projectId: "P00",
      }),
    ).rejects.toThrow("this course");
  });
  it("audio upload and metadata enforce author/course; members can listen, outsiders cannot", async () => {
    await login(friend);
    const path = await rpc<string>("academy_register_file", [
      aid,
      "fourth",
      "friend-file",
    ]);
    await db.query(
      `insert into storage.objects(bucket_id,name) values('studio-audio',$1)`,
      [path],
    );
    await write("friend-work", "fourth", "note", friend, {
      title: "demo",
      fileId: "friend-file",
      remotePath: path,
    });
    await login(owner);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      2,
    );
    await expect(
      write("stolen-work", "fourth", "note", owner, {
        title: "stolen",
        fileId: "friend-file",
        remotePath: path,
      }),
    ).rejects.toThrow("author/course");
    await login(outsider);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
  });
  it("duplicate invitation, send failure, revocation, expiration and resend are explicit", async () => {
    await login(owner);
    await expect(
      rpc("academy_prepare_invitation", [
        aid,
        "friend@example.com",
        crypto.randomUUID(),
        "c".repeat(64),
      ]),
    ).rejects.toThrow("already an active member");
    const id = crypto.randomUUID();
    await rpc("academy_prepare_invitation", [
      aid,
      "outsider@example.com",
      id,
      "d".repeat(64),
    ]);
    await expect(
      rpc("academy_prepare_invitation", [
        aid,
        "outsider@example.com",
        crypto.randomUUID(),
        "e".repeat(64),
      ]),
    ).rejects.toThrow("already being sent");
    await login("", "service_role");
    await rpc("academy_invitation_delivery", [id, false, "SMTP rejected"]);
    await login(owner);
    let snapshot = await rpc<{
      invitations: { id: string; status: string; ticket_hash?: string }[];
    }>("academy_snapshot", [aid]);
    expect(snapshot.invitations.find((i) => i.id === id)!.status).toBe(
      "failed",
    );
    expect(
      snapshot.invitations.find((i) => i.id === id)!.ticket_hash,
    ).toBeUndefined();
    const id2 = crypto.randomUUID();
    await rpc("academy_prepare_invitation", [
      aid,
      "outsider@example.com",
      id2,
      "e".repeat(64),
    ]);
    await login("", "service_role");
    await rpc("academy_invitation_delivery", [id2, true, null]);
    await login(owner);
    await rpc("academy_revoke_invitation", [aid, id2]);
    await login(outsider);
    await expect(
      rpc("academy_accept_invitation", [id2, "e".repeat(64)]),
    ).rejects.toThrow("revoked");
    await login(owner);
    const id3 = crypto.randomUUID();
    await rpc("academy_prepare_invitation", [
      aid,
      "outsider@example.com",
      id3,
      "f".repeat(64),
    ]);
    await login("", "service_role");
    await rpc("academy_invitation_delivery", [id3, true, null]);
    await db.exec("reset role");
    await db.query(
      `update academy_invitations set expires_at=now()-interval '1 second' where id=$1`,
      [id3],
    );
    await login(outsider);
    await expect(
      rpc("academy_accept_invitation", [id3, "f".repeat(64)]),
    ).rejects.toThrow("expired");
  });
  it("removed member existing session immediately loses table/RPC/audio permissions, history and signature stay", async () => {
    await login(friend);
    await expect(rpc("academy_remove_member", [aid, owner])).rejects.toThrow(
      "Admin",
    );
    await login(owner);
    await rpc("academy_remove_member", [aid, friend]);
    await login(friend);
    expect(
      (await db.query("select * from academy_documents")).rows,
    ).toHaveLength(0);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
    await expect(rpc("academy_snapshot", [aid])).rejects.toThrow("membership");
    await expect(
      write(
        "friend-note",
        "fourth",
        "note",
        friend,
        { title: "unauthorized" },
        1,
      ),
    ).rejects.toThrow("Inactive");
    await login(owner);
    expect(
      (
        await db.query(`select * from academy_documents where author_id=$1`, [
          friend,
        ])
      ).rows.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await db.query(
          `select * from academy_members where user_id=$1 and not active`,
          [friend],
        )
      ).rows,
    ).toHaveLength(1);
  });
});
