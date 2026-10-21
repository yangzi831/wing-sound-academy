# WING SOUND ACADEMY

个人电子音乐学院教务与创作平台，React + TypeScript + Vite，GitHub Pages + Supabase Auth / Postgres / 私有 Storage。

站点：https://yangzi831.github.io/wing-sound-academy/

## 本地启动

推荐 Node.js 22.10+。

```bash
npm ci
# 复制 .env.example 为 .env.local，填写真实项目 URL 与 Publishable Key
npm run dev
npm test
npm run build
npm run preview
```

开发地址固定为 http://127.0.0.1:5173/ ，预览地址为 http://127.0.0.1:4173/ 。两者及正式域名的本机缓存相互独立。无云配置时只显示公开课程大纲；旧个人数据保留，不会被默认课程覆盖。

## Supabase 配置（站点所有者执行一次）

代码不会自动创建项目或生成密钥，也没有服务端私钥。按以下顺序配置：

1. 登录 https://supabase.com/dashboard → **New project**，创建自己的项目。数据库密码只保存在你的密码管理工具中，不填写到网站或 GitHub 前端环境变量。
2. 打开项目 **SQL Editor → New query**，粘贴并运行 `supabase/migrations/202610210001_studio_sync.sql` 全文，运行一次即可。脚本会创建独立记录、历史表、版本检查函数、RLS，以及 `studio-audio` 私有 Bucket。执行失败时事务会回滚，不要只执行其中几行。
3. **Authentication → URL Configuration**：Site URL 填 `https://yangzi831.github.io/wing-sound-academy/`。Redirect URLs 精确加入同一地址；开发时另加入 `http://127.0.0.1:5173/`，需要预览登录时加入 `http://127.0.0.1:4173/`。不添加通配域名、不附带 `#overview` 等路由。
4. **Authentication → Sign In / Providers**：启用 Email；关闭 **Allow new users to sign up** 和匿名登录。应用发送验证码时也设置 `shouldCreateUser: false`，没有自助注册入口。
5. **Authentication → Users → Add user → Invite a user**，仅邀请你的邮箱。使用邀请邮件确认身份。复制这个用户的 **User UID**。如 UI 菜单名称随 Supabase 版本调整，可在 Authentication 的 Users 页查找邀请入口。
6. 回到 **SQL Editor**，将下面占位内容换成真实 User UID 后执行：

   ```sql
   insert into public.studio_owners(user_id)
   values ('把这里替换为你在 Authentication Users 中复制的真实 UUID')
   on conflict do nothing;
   ```

   `studio_owners` 没有任何前端写入权限。即使其他账号意外注册成功，也不能读取或写入个人记录或音频。只加入你本人的 UID。
7. **Authentication → Email Templates → Magic Link**：让邮件包含一次性验证码 `{{ .Token }}`。例如邮件正文可为 `<h2>WING SOUND ACADEMY</h2><p>登录验证码：{{ .Token }}</p>`。网站直接输入邮件验证码登录；如果保留 Magic Link，SDK 也会在挂载私人页面前处理登录回调。若邮件未到达，检查 Auth 日志、垃圾邮件和 Supabase 默认邮件服务的收件限制；按需配置自有 SMTP，SMTP 密钥只留在 Supabase。
8. **Project Settings → Data API** 复制 **Project URL**（末尾不加斜杠）；**Settings → API Keys** 复制以 `sb_publishable_` 开头的 **Publishable Key**。这是公开浏览器配置，权限依赖 RLS 和已验证身份。**不使用 `service_role`、`sb_secret_`、数据库密码或旧式私钥。**
9. GitHub 仓库 **Settings → Secrets and variables → Actions → Variables → New repository variable**，设置：

   | 名称 | 值 |
   | --- | --- |
   | `VITE_SUPABASE_URL` | 真实 Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | 真实 Publishable Key |

10. 仓库 **Actions → Deploy GitHub Pages → Run workflow → main**，等待构建与部署完成。本地开发将相同两项放进被 Git 忽略的 `.env.local`，然后重启开发服务。

Vite 在构建时校验配置。缺少两项配置时会发布公开大纲与配置提示；只填一项、URL 格式错误或使用非 Publishable Key 时，构建会停止，错误信息不打印密钥。前端环境变量在构建时进入浏览器包；后续修改 GitHub Variables 必须重新运行部署。

Supabase 默认会话持久化并自动刷新。新设备第一次验证邮箱即可；会话过期、手动退出、浏览器清理或服务端撤销可能要求再次验证。使用新版 Chrome、Edge 或 Safari；同一浏览器仅允许一个标签页持有编辑锁，其他标签页会提示关闭重复页面。

## 第一次迁移与换设备

登录前只显示内置公开课程大纲，不读取个人缓存到页面，也不开放修改。登录后服务器验证邮箱已确认且 UID 位于允许名单。

第一次在一个设备启用同步时，先读取原 `wing-sound-academy:v1` 和云端快照，显示记录数量与差异摘要，不自动上传或覆盖：

- 云端为空：点击「确认将本机记录及音频迁移到云端」。已有16周与P00–P04沿用原 ID，只建立一次，不追加第二套课程。
- 两边都有数据：选择「比较并合并两边记录」，不同记录逐条选择或手动合并；也可明确选择使用云端，或确认以本机替换云端。替换产生的旧云版本留在历史表中。
- 新手机没有旧资料时，直接选择「使用云端」；旧数据设备先完成迁移并显示「已同步」，再在新设备登录，流程最简单。

每次选择迁移、导入或处理冲突前，都必须成功写入 IndexedDB 恢复快照。快照写入失败会停止操作。原版 localStorage 和音频不会自动删除；完成云端回读与音频字节校验后才显示「已同步」。中途关页、上传失败或断网时，保留缓存与待同步差异，可重试。

大于45 MB或不支持格式的旧音频会提示重新添加较小的试听文件；独立的文字记录仍可同步。原文件继续保留在旧 IndexedDB 和完整备份中。音频上传尚未完成时，与之关联的讲评会等待，避免其他设备收到不可用的关联。

## 云同步、本机缓存、文件存储与备份的区别

| 层 | 保存内容 | 用途 |
| --- | --- | --- |
| Supabase Postgres | 学期设置、周次内容/进度/笔记、项目/五阶段/总结、讲评及版本关联、档案元数据 | 授权设备共同使用的记录 |
| 本机 localStorage | 按用户 UID 隔离的当前数据、已知服务器版本、未同步差异与冲突 | 即时保存、离线编辑、刷新后续传 |
| IndexedDB | 音频原始字节、云音频本机缓存、迁移及恢复快照 | 离线试听、上传重试、恢复迁移前内容 |
| Supabase 私有 Storage | 每个文件 ID 对应的不可变试听文件 | 登录授权后跨设备下载和播放 |
| 手动完整 JSON 备份 | 课程与个人数据、音频 Base64 字节 | 独立灾难恢复、离开此平台仍能保存文件 |

云同步会传播修改与删除，不能替代独立备份。浏览器清理可能删除离线未同步记录、恢复快照和本机文件。退出登录不清除缓存，但页面不再显示私人内容；本机缓存不加密，请保护设备的系统账户。没有网络且从未缓存过的文件不能试听。静态网站没有 Service Worker：已加载页面断网后能继续编辑，完全断网时首次打开网页仍需浏览器已有资源缓存。

### 自动保存与冲突

每周、每个项目、每条讲评、每份档案、课程设置各为一个数据库实体。修改只写入变化的实体，服务器以 `expected revision` 做原子比较并增加版本号；不会每输入一个字符就覆盖整份学期。P04五阶段、创作总结及音频时间位置反馈沿用原字段。

文字立即保存至本机，停止输入约0.9秒后同步；每15秒、恢复网络、页面重新可见时检查云端。显示「已同步 / 同步中 / 未同步 / 离线 / 同步失败 / 存在冲突」。页面关闭后不会在后台上传，重新打开会继续处理持久化差异。数据请求15秒超时，音频传输允许180秒。

如果同一实体在两个设备都有修改，会保留双方完整对象并暂停该实体的自动覆盖。点击顶部同步状态查看字段差异，选择本机、云端或手动合并，亦可先下载两个版本。即使选择后云端又被修改，下一次版本检查仍会再次产生冲突。不同实体的编辑可独立同步。

删除使用墓碑记录，避免旧设备复活已删除档案。删除或改分类的音频档案会在同一数据库事务中清除讲评关联，保留讲评文字和历史；与本机未同步讲评相交时保留关联档案并提示冲突，先处理讲评关联再选择删除档案。同步管理可查看最近100个云端历史版本、下载或恢复；更多历史可在 Supabase 表中按 UID/记录 ID 查询。

### 音频

只接受试听音频，不同步DAW工程。支持 MP3、M4A、AAC、WAV、OGG、FLAC、AIFF 和 WebM 文件扩展名；能否解码取决于浏览器，跨手机优先 MP3 / M4A。前端与 Bucket 都限制单文件45 MiB，低于免费方案常见单文件上限；总容量、流量和项目暂停规则请以自己 Supabase Dashboard 的当前配额为准。

先写入本机 IndexedDB，再上传 `用户UID/文件UUID`，不覆盖同路径。上传后回读校验大小和 SHA-256，通过后才发布元数据给其他设备。失败显示原因并保留文件，可在档案卡片重试或更换文件。下载通过已登录 SDK 调用私有 Storage，保存为本机 Blob 播放；不生成公共URL或将签名URL存进备份。首次跨设备试听需要完整下载该试听文件。

更换文件使用新文件 ID。移除档案或更换音频时旧文件保留以支持冲突/历史恢复。同步管理里的「私有音频管理」可列出当前档案未引用的文件、下载原文件并明确确认永久删除。永久删除前请确认其他设备已同步且保有备份；历史音频引用可能依赖旧文件。清理最多列出1000个文件，不会自动批量删除。本机原文件不自动清理。

### 完整 JSON 与恢复

右上「数据管理」保留导入、导出功能。完整导出会为本机缺少的云音频进行授权下载，再打包原始字节；失败明确报错，不导出声称完整但缺少音频的备份。外部作品链接仅备份地址，无法复制远端平台的文件。

完整备份仍为 `wing-sound-backup` version1。旧版备份可导入，先验证16周、5项目、日期、类型、作品关联和全部文件，再给音频分配新 ID；旧云文件路径会移除，随后作为新的本机文件安全上传。导入不直接写云端，也不改写旧 `wing-sound-academy:v1`，先快照当前状态再经同步版本检查。无效备份不会覆盖现有文字或音频。

同步状态 JSON、冲突 JSON 和恢复快照原文仅用于诊断/人工恢复，可能包含两边版本文字，**不是带音频的完整备份**，请妥善保管。恢复快照区可直接导出符合完整导入格式的 JSON。

## 数据模型与最小迁移范围

- 保留 schemaVersion1、W01–W16、P00–P04、2026-10-25至2027-02-07每周日、所有原字段和内部旧枚举。展示继续使用音乐专业术语映射。
- `Artifact` 仅新增可选 `remotePath / fileSize / fileHash`，原 `fileId` 和 IndexedDB 数据库不变。
- `studio_records` 用 `(user_id, kind, id)` 标识独立实体，种类为 semester/session/project/critique/artifact；JSONB保存原字段而不拆散创作记录。`studio_history` 保留每次成功提交。数据库不放默认课程种子，不会在每次登录重复创建项目。
- 新缓存键：`wing-sound-sync:v1:用户UID`；原 `wing-sound-academy:v1`只读迁移来源。恢复快照库：`wing-sound-sync-recovery`。
- 所有个人表启用RLS，普通用户仅可读自己的记录/历史；修改必须走验证身份及允许名单的CAS函数。直接 REST 写表被拒绝。Storage策略同时检查允许名单、已验证用户和路径UID。
- 公开GitHub仓库只包含代码、SQL和公开配置示例；没有密钥文件。`.env.local`被忽略，构建拒绝非Publishable Key。

## 保留的课程与视觉功能

总览、16周课表与编辑、P00–P04任务书与状态、P04五阶段、创作过程与总结、讲评记录/音频版本/时间位置反馈、作品档案、原生音频播放、课程设置和完整备份均保留。日期只定位课程，不会自动完成任务。

保持黑白灰、电蓝、细线网格和正文16px。项目艺术封面为本项目原创生成式SVG（`src/assets/artwork`），不冒充真实音频分析；`node scripts/generate-artwork.mjs`可重新生成。

## 部署

`.github/workflows/deploy-pages.yml`：push main → npm ci → npm test → npm run build → GitHub Pages。使用仓库 Variables 注入两项Vite配置。`base: './'`与hash路由不变；回调回到项目根目录，SDK处理身份信息后再挂载App，避免hash路由误吞登录信息。

## 验证范围与实际启用检查

`npm test`包含旧备份兼容、日期与关联校验，以及两个模拟客户端的独立实体同步、离线重载、并发CAS、冲突保留/合并/快照、墓碑、上传失败重试和私有下载字节验证。PGlite运行实际PostgreSQL迁移脚本，验证RLS、未授权/未验证/匿名拒绝、禁止直接写表、历史不可改、私有Storage行策略和关联删除事务。

这些本地测试不替代你的真实项目验证。配置项目并部署后，在两个不同浏览器/设备完成：

1. 公司电脑邮箱登录，确认迁移；写一条W01笔记，等待「已同步」。家里电脑/手机登录后选择云端，确认文字与课程完成状态一致。
2. 上传小型MP3 / M4A Demo，等待校验完成，另一设备在相同档案试听。
3. 保持页面打开，断网写笔记；恢复网络后刷新并检查本机队列仍在，点击同步，另一设备读取。
4. 两设备断网修改同一条笔记，再依次联网。确认出现冲突、双方内容均可下载，手动合并后两边一致。
5. 导入一份旧版完整JSON，检查音频字节、讲评版本关联、五阶段与总结；同时检查导入前恢复快照。
6. 退出登录只能查看公开大纲；未授权账号和未登录请求均不能读私人表或Bucket。

当前是否已配置真实后端以及线上验证结果见 `QA.md` 的最新记录。
