# WING SOUND ACADEMY

> 当前项目的实际配置进度见 [HANDOFF.md](HANDOFF.md)（2026-11-06）：学院迁移已执行、SMTP 已保存、网页邀请已被邮件服务接受；朋友收信与加入仍待确认。下方为通用配置步骤，已完成的 migration 无需重跑。

学院课程与创作平台。React + TypeScript + Vite；GitHub Pages + 现有 Supabase Auth / Postgres / 私有 Storage。

网站：[https://yangzi831.github.io/wing-sound-academy/](https://yangzi831.github.io/wing-sound-academy/)

## 本地开发与检查

推荐 Node.js 22。执行 `npm ci`、`npm run dev`；校验使用 `npm test`、`npm run check:edge`、`npm run build`。
将 `.env.example` 复制为被 Git 忽略的 `.env.local`，仅填写真实项目 URL 和 Publishable Key。
开发地址 `http://127.0.0.1:5173/`；无云配置或未登录时仅展示公开电子音乐大纲。

## 架构与本次调整

原 `AcademyData` 把单套16周课程和个人数据组合在一起。原 hash 路由、`types.ts`、`data.ts`、`storage.ts` 和电子音乐页面保留，通过 `ElectronicAdapter` 投影为当前作者的数据；组合后的对象不再整体上传。

组织方式是「学院 → 课程 → 课次或项目 → 作者的学习记录」。学院首页是课程入口，课程选择使用 `?course=课程ID`；电子音乐内部继续使用原 `#overview`、`#schedule`、`#week/W01`、`#projects`、`#project/P04`、`#critique`、`#archive`、`#syllabus`。旧深链接仍进入电子音乐课程。

| 层         | 数据与实现                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| 学院与成员 | `academies`、`academy_members`；学院权限仅管理员 / 成员                                               |
| 共同课程   | `academy_documents` 中无个人作者的 `course / lesson / project`；每条独立版本                          |
| 个人记录   | 同表中有 `author_id + course_id` 的 `week / process / note / artifact / critique`；可选课次、项目关联 |
| 反馈       | `feedback` 有自己的作者和目标记录，不能代改对方作品                                                   |
| 冲突与历史 | `academy_history` + 每条记录 CAS revision；本机保存冲突双方                                           |
| 文件       | `academy_files` 登记课程 / 学院 / 作者，`studio-audio` 继续私有                                       |
| 邀请       | `academy_invitations`；`academy-invite` Edge Function 负责 Auth 管理与真实邮件发送                    |

新增代码分别位于 `academy-model.ts`、`academy-engine.ts`、`academy-api.ts`、`academy-ui.tsx`，旧云同步模块作为迁移前兼容界面保留。服务器尚无 `academy_index` 时，新前端继续运行旧个人工作室；增量迁移成功并刷新后才启用学院界面。

首批课程：

- **电子音乐制作**：原16周、P00–P04、2026-10-25开始且每周日。课程大纲、教学目标、课次任务与项目任务书在前端及服务端固定；个人进度、笔记、五阶段、过程、作品、总结和讲评继续编辑。
- **键盘**：仅空课程框架。原管理员默认老师，后加入成员默认学生。
- **小提琴**：仅空课程框架。原管理员默认学生，后加入成员默认老师。

管理员可在网页新增、排序、归档、恢复自定义课程，并设置每个人的课程角色。成员共同编辑简介、目标、课次主题、内容、练习、参考资料和可选日期；不强制16周或5项目。课程角色不授予学院管理权。学习进度按作者与课次去重；老师显示备课和反馈任务，不计算学生作业完成率。

## 现有 Supabase 项目升级：只做一次

当前沿用项目 `fcesbvigirhkjpfrxqpd`。前端发布不等于数据库或 Edge Function 已发布。完整 SQL 与函数代码已提供；需要项目所有者在自己的后台或已登录 CLI 执行以下步骤。**不要把管理密钥发到聊天或填进 VITE 变量。**

### 1. 保留备份，执行增量 migration

1. 在原网站登录，确认尽量同步完成，导出带音频的完整 JSON；保留旧设备的浏览器缓存。条件允许时另做 Supabase 数据库备份。
2. 打开 **Supabase Dashboard → 现有项目 → SQL Editor → New query**，执行 **`supabase/migrations/202611060001_academy.sql` 全文**。原 `202610210001_studio_sync.sql` 已执行过时不要重跑。
3. 脚本在一个事务中创建新表、权限和函数，给原 `studio_owners` 中的每位所有者建立确定ID的学院及管理员身份，并将旧云数据按原作者拆分。不会删除或清空旧表；会保存 `academy_legacy_snapshot`，迁移每个历史版本并登记旧音频路径。共同课程只建立一份。
4. 失败时事务回滚，修正原因后重跑全文；已成功时无需再次执行，重复运行会在建表阶段停止，不能重复生成课程。通过 Supabase CLI 管理数据库的项目应使用已登记迁移历史的 `supabase db push`，不要与未登记的 SQL Editor 执行方式混用。
5. 刷新网站。原管理员自动看到3门课程。浏览器中尚未上传的旧记录，在「同步与备份 → 检测到旧版本机数据」中明确比较导入；不会自动把本机默认空内容上传到学院。朋友不导入你的旧缓存，从空白个人记录开始。

新安装才需要先执行旧 migration、通过 Auth 建立并验证第一位管理员、一次性将该账号加入 `studio_owners`，然后执行学院 migration。现有项目无需重新建立管理员；日后邀请朋友均在网页完成，不需要 UID 或 SQL。

### 2. Auth 设置

**Authentication → URL Configuration**：

- Site URL：`https://yangzi831.github.io/wing-sound-academy/`
- Redirect URLs：保留精确根地址，并增加 `https://yangzi831.github.io/wing-sound-academy/**`，仅允许固定域名下本项目路径与动态邀请查询参数；不使用通配域名。开发需要时另加 `http://127.0.0.1:5173/**` 和 `http://127.0.0.1:4173/**`。缺少这项匹配可能使 Auth 回退到 Site URL，丢失邀请参数。
- **Sign In / Providers**：启用 Email；保持关闭公众注册和匿名登录。普通登录发送 OTP 时 `shouldCreateUser: false`。
- 保持 Email 的 **Confirm email** 开启；Invite user 与 Magic Link 邮件模板按下一节配置。Magic Link 同时提供 `{{ .ConfirmationURL }}` 和 `{{ .Token }}`，既能点击验证，也能在页面输入验证码。会话持久化、自动刷新，不要求每次打开重新登录。

### 3. 一次性配置 Gmail SMTP（无需自有域名）

邀请与日常登录统一使用 **Supabase Auth → 后台配置的 SMTP → Gmail**。Edge Function 不连接第三方邮件 API，不读取 Gmail 密码；不需要自有域名、DNS 验证、Resend 账号或 API Key。

1. 打开发信 Gmail 的 [Google 账号安全设置](https://myaccount.google.com/security)，启用「两步验证」。
2. 打开 [应用专用密码](https://myaccount.google.com/apppasswords)，创建名为「WING SOUND ACADEMY / Supabase」的密码。Google 生成16位应用专用密码；**不要使用 Gmail 日常登录密码**。此密码只填写到下述 Supabase SMTP Password 字段，不发到聊天，不放进前端、GitHub Variables、仓库或 Edge Function Secrets。
3. 打开 **Supabase Dashboard → 现有项目 → Authentication → Email → SMTP Settings**（不同后台版本也可能在 Project Settings → Authentication → SMTP Settings），启用 **Custom SMTP**，填写：

| 字段 | 内容 |
| --- | --- |
| Sender email | 你用于发信的完整 Gmail 地址 |
| Sender name | WING SOUND ACADEMY |
| Host | smtp.gmail.com |
| Port | 465（SSL/TLS）；如选择587则使用 STARTTLS |
| Username | 同一个完整 Gmail 地址 |
| Password | Google 生成的16位应用专用密码，复制时去掉显示用空格 |

发件地址与认证 Gmail 保持一致，不填虚构的 academy@自有域名。若没有应用专用密码入口，检查两步验证是否开启，以及高级保护或单位账号策略是否限制。修改 Google 主密码可能撤销已有应用专用密码，届时重新生成并更新 Supabase 后台。

4. 在 **Authentication → Email Templates** 更新两个模板（只粘贴仓库对应HTML，不填写任何密码）：
   - **Invite user**：复制 `supabase/templates/invite-user.html`，主题可设为「WING SOUND ACADEMY · 学院成员邀请」。
   - **Magic Link / OTP**：复制 `supabase/templates/magic-link.html`，主题可设为「WING SOUND ACADEMY · 邮箱验证与登录」。
   - **必须保留 `{{ .ConfirmationURL }}` 完整链接**。Auth 会将本次请求的完整 redirect_to（包括 invitation 与 ticket）写入验证链接，不要改成固定 Site URL，也不要只发送验证码。Magic Link 模板同时保留 `{{ .Token }}` 供日常OTP登录。
5. 检查 **Authentication → URL Configuration** 中精确 Site URL 和项目路径范围的 Redirect URLs，按上一节配置。保持关闭公众注册、匿名登录，开启 Email 和邮箱确认。**Send Email Auth Hook 如仍连接旧邮件服务，应停用该邮件钩子，使 Auth 使用这里的 SMTP**，其他身份校验不变。
6. 保存后在网页邀请真实朋友邮箱验证收信与加入；查看 **Authentication → Logs / Auth Logs** 排查 SMTP 错误。Gmail 与 Supabase Auth 都有发信频率限制，可在 **Authentication → Rate Limits** 查看；遇到限流稍后重发，不要密集点击。没有通过真实邮箱收信不视为端到端验证完成。

Edge Function Secrets 仅需按现状保留 `SITE_URL=https://yangzi831.github.io/wing-sound-academy/`（未设置时代码也使用此默认值）。`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 继续来自服务端运行环境；不放进 VITE 变量。旧 `RESEND_API_KEY` / `INVITE_FROM` 已不再读取，可在 Secrets 中删除；不要删除 Supabase 自动提供的运行环境配置。

参考：[Supabase 自定义 SMTP](https://supabase.com/docs/guides/auth/auth-smtp)、[Google 应用专用密码](https://support.google.com/accounts/answer/185833)、[Gmail SMTP 端口](https://developers.google.com/workspace/gmail/imap/imap-smtp)。

### 4. 部署 Edge Function

在仓库根目录使用已授权的 Supabase CLI：

```bash
npx supabase login
npx supabase functions deploy academy-invite --project-ref fcesbvigirhkjpfrxqpd
```

本次SMTP改动不新增SQL，不改已有数据库、学院邀请票据或RLS。已安装学院 migration 的项目无需再运行SQL；重新部署同名函数即可切换发信方式。函数部署不会自动更新SMTP、Email Templates或Redirect URLs，仍需完成上面的后台设置。前端回调也已同步调整，需发布本次前端版本。

或在 Dashboard 的 Edge Functions 中部署 `supabase/functions/academy-invite/index.ts`。`supabase/config.toml` 关闭网关旧式 JWT 校验以兼容新的签名密钥；**函数自身调用 `auth.getUser()` 验证会话，并使用用户上下文 RPC 验证学院管理员**，不能跳过这些检查。可使用 `deno check supabase/functions/academy-invite/index.ts` 在装有 Deno 的环境检查真实 Deno 类型；本仓库 `npm run check:edge` 使用 TypeScript、真实 SDK 类型和最小 Deno 全局声明检查，不冒充 Edge Runtime 集成测试。

### 5. 前端与 GitHub Pages

保留现有仓库 **Settings → Secrets and variables → Actions → Variables** 两项：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`。仅允许 `sb_publishable_` 前缀，构建拒绝服务端密钥。现有项目配置不需要更换。

`main` 推送后 GitHub Actions 执行 `npm ci → npm test → npm run check:edge → npm run build → Pages`。前端不需要因新增课程重新部署。部署环境变量修改则需要重新构建。无数据库管理凭据时不能靠 Publishable Key 执行 SQL 或部署服务端函数。

## 日常邀请与权限

管理员打开「成员与邀请」，输入朋友邮箱发送。界面仅在邮件服务接受且数据库状态确认后显示已发送；提供状态、失败原因、重发、撤销与移除成员。邮件投递接受不保证一定到达收件箱，SMTP问题请查看Supabase Auth Logs及Gmail发信状态。

新账号调用服务端 `inviteUserByEmail(email, { redirectTo })`，由Auth创建待验证身份并通过SMTP发送邀请；已有已确认账号收到重复邮箱错误后，调用 `signInWithOtp({ options: { shouldCreateUser: false, emailRedirectTo } })` 发送登录邮件，不生成第二个账号。两条路径使用同一个带 `invitation` 与 `ticket` 的回调地址，Supabase的 `ConfirmationURL` 负责先验证邮箱再返回网站。原先已发送的 token_hash 邀请邮件仍兼容。票据在数据库仅存 SHA-256；接受时服务器检查当前账号的真实已验证邮箱、票据、学院、发送状态与7天有效期，再绑定成员身份。不是 Supabase 后台团队成员邀请。

重复邀请会撤销旧票据并旋转新票据，发送中防重，成功发送后60秒内限制重发。过期、撤销或发送失败的邀请无法接受。Auth 邮箱确认 token 通常比7天更早过期，以项目 Auth 设置为准：打开链接后可用同一受邀邮箱 OTP 登录，再接受保留在当前标签页的邀请；后续登录邮件也携带原邀请参数，换标签页打开仍能继续。页面先等SDK消费登录回调，再清理地址栏参数，票据直到服务端确认加入后才删除。也可请管理员重发新链接。

普通成员不能邀请或移除成员。服务器 RLS 和 RPC 同时执行：固定课程不可写、作者不可更换、仅作者能改自己的记录、成员能看学院记录与私有音频。移除成员将其设为 inactive，不删除历史与署名；其已有 JWT 也会失去后续服务器读写和文件权限。已下载到其设备的旧副本无法远程抹除。之后新建的共享课程自动对有效成员开放。

## 云同步、缓存、音频与备份

| 保存位置                                      | 作用                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| Supabase 数据库                               | 学院成员、共享课程、独立作者记录、历史版本和文件登记；服务器为权限依据 |
| `wing-academy:v2:学院ID:用户UID` localStorage | 当前文档、已知云版本、待同步差异和冲突；旧缓存原样保留                 |
| 原 `wing-sound-audio/files` IndexedDB         | 音频字节和下载缓存，继续兼容原文件ID                                   |
| `wing-academy-recovery/snapshots` IndexedDB   | 首次升级及导入、冲突处理前的可恢复快照，页面提供原文和完整备份导出     |
| Supabase `studio-audio` 私有 Bucket           | 新路径 `学院ID/作者UID/文件ID`，旧路径继续登记授权；不是公共下载URL    |
| 学院完整 JSON version2                        | 双方可见记录、共享框架、完整音频字节；独立灾难恢复                     |
| 原电子音乐完整 JSON version1                  | 当前作者的电子音乐记录与音频；旧备份继续可导入导出                     |

修改即时写本机，停止输入约0.9秒后同步；每15秒、恢复网络和页面重新可见时检查。每条课次、每人的记录独立CAS更新，失败保留原数据。两设备同时编辑同一课次会保留冲突双方，允许下载、选择和手动合并，处理前先写恢复快照。关闭页面不会后台上传，重开继续；没有 Service Worker，完全断网首次开站仍需要浏览器已缓存网页资源。

完整备份导出会授权下载缺少的音频，下载失败时整体报错，不导出虚假的完整备份。导入先保留快照、校验再应用：只恢复当前作者，差异进入比较，不删除备份未列出的记录；不把对方作品改成自己的。管理员可显式勾选恢复自定义共同课程框架，固定电子音乐内容不导入覆盖。不同学院备份不能混合身份。备份仍包含对方记录用于保存，但不能冒充对方恢复；恢复对方记录需其本人登录。原版16周校验仅用于旧备份与电子音乐投影，不限制新增自定义课程。

音频 ≤45 MiB，优先 MP3/M4A；支持格式及浏览器解码限制沿用原实现。文件先存本机，再上传、回读验证大小与SHA-256，再发布元数据。失败保留文件，可同步重试、移除关联或替换；不上传DAW工程。成员用授权SDK下载私有音频为Blob播放，不保存公共/签名URL。更换音频使用新ID；原音频保留支持冲突与历史恢复，「我的私有音频文件」可下载并明确确认永久删除未引用文件。只能删除本人文件，服务器拒绝删除仍被记录引用的文件；永久删除会影响历史试听。

云同步不是备份。清理浏览器会丢失尚未同步的记录、本机音频和恢复快照；请定期另存完整JSON。退出后页面不显示私人内容，本机缓存不加密，应保护设备账户。

## 验证与上线验收

最新结果见 [QA.md](QA.md)。本地测试包含实际 PostgreSQL/PGlite 执行两份 migration、RLS/RPC/Storage策略、迁移历史与原音频路径、两作者同步、第四门课程、离线重载、并发冲突、备份与模拟邮件边界。模拟客户端和邮件服务测试不是两台真实设备或真实邮箱测试。

完成上述一次性后台部署后，需要用两个真实邮箱 / 浏览器验收：

1. 原管理员检查原笔记、P04五阶段、版本讲评关联、音频试听，并导出新备份。
2. 网页邀请朋友，实际收信并确认，自动加入同一学院；朋友个人进度为空，可查看原管理员记录。
3. 新增第四门课程，另一账号 / 设备可见；双方编辑自定义课次，固定课程直接RPC改写仍被拒绝。
4. 分别写笔记、提交试听文件、互留反馈，筛选作者并在另一设备播放；老师不显示学生作业完成要求。
5. 断网编辑后恢复网络，同步成功；并发改同一课次产生可恢复冲突，旧内容不静默丢失。
6. 撤销 / 过期邀请不能加入；普通成员和外部账号不能管理成员。移除已登录成员后，其数据及音频请求被拒绝。
7. 导入旧完整JSON，比较差异、试听音频并确认恢复快照。迁移前后不手动清除旧数据。

保留黑白灰、电蓝、原创SVG项目封面、16px正文与原电子音乐工作台；新增学院层与简单表单，不引入后台管理系统。
