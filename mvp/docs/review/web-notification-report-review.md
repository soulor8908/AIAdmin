---
doc_type: Review-Report
id: REVIEW-WEB-NOTIFICATION-REPORT-001
tech_spec_ref: TECH-WEB-NOTIFICATION-REPORT-001
prd_ref: PRD-WEB-NOTIFICATION-REPORT-001
verdict: pass
created: 2026-07-03
---
# 前端通知管理页 + 报表页 · Code Review 报告（R15 前端全域覆盖收尾，auth/user/role/dept/audit/notification/report 七域）

评审范围：R15 前端全域覆盖收尾全部交付——`apps/web/src/` 7 个新增实现文件（api/notifications.ts、api/reports.ts、pages/NotificationListPage.tsx、pages/ReportPage.tsx、components/NotificationForm.tsx、components/ReportFilter.tsx、components/ReportTable.tsx）+ 3 个 R12/R14 既有文件改动（api/client.ts query 类型扩展 D8、lib/errorMapping.ts 扩展 SPECIFIC_MESSAGES D9 + R14 S-11 同步注释、components/Sidebar.tsx 6 入口 D17、App.tsx 新增 2 路由 D17）+ `apps/web/test/` 5 个新增测试文件（api-notifications.test.ts、api-reports.test.ts、notification-list-page.test.tsx、notification-form.test.tsx、report-page.test.tsx）+ 2 个新增独立文件承接 ①类显式影响（navigation-extend.test.tsx、error-mapping-extend-2.test.ts）+ 1 处 R14 既有测试断言 matcher 调整（navigation.test.tsx 4→6 入口）+ 1 处 R12 既有测试 D8 后向兼容核验（api-client.test.ts RequestOptions query: { page: 1 }）+ 1 处 vitest.config.ts testTimeout 调整。对照 `docs/prd/web-notification-report.md`（11 BLOCKING Q&A + BA 核验 N1~N6 + 54 条 AC = 49 功能 AC F1-F10 + 3 ARCH-003 专项 + 2 R13 S-1 专项 + AC↔测试覆盖矩阵）、`docs/spec/web-notification-report.tech.md`（D1~D21 决策 + §9 受影响测试清单 + §10 末 8 条多[约束]组合副作用预判）与 `.trae/rules` 全部规则逐条核查。

本轮 R15 核心验证点：①前端全域覆盖收尾（7 域，新增通知状态机域 + 报表聚合只读域两种新数据形态验证 R12 基础设施复用性）②versioned 写操作多端点复用再验证（通知域一次性引入 4 个 versioned 写端点 PATCH/POST send/POST read/DELETE，全部 If-Match + 409 重试复用 R12 D9，密度高于 R12 1 端点 / R14 1 端点）③状态机驱动域前端模式（draft→sent→read 三态 + append-only 守卫 + 按 status 动态显示按钮 + status 文案中文化）④聚合只读域 + 动态维度前端模式（reportAggItemSchema z.record 动态键 + ReportTable 据 result.group_by 动态渲染列头）⑤D8 client.ts query 类型扩展支持 string[]（repeated key，对齐 server.ts m.query.getAll，最小后向兼容增强）⑥D9 errorMapping 扩展 + R14 S-11 同步注释闭合（注释从"REPORT/NOTIFICATION/TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"）⑦R13 S-1 在状态机/聚合域下落地（NotificationForm safeParse vs send/markRead/delete/group_by checkbox/entity_type select 类型派生）⑧①类显式影响处理范例再验证（R14 navigation.test.tsx 4→6 入口 + R14 error-mapping-extend.test.ts 预估不失效核验）⑨impl-writer 测试 setup 改动核对（UUID fixture hex 校准 / testTimeout 提升 / label 消歧 / option text 改英文）⑩ARCH-003 在新增模块下持续合规。

## §0 速览

- **verdict**：**pass**
- **blocker 数**：**0**
- **suggestion 数**：**8**
- **AC 对齐数**：**54/54 ✅**（功能 49/49 ✅ + ARCH-003 专项 3/3 ✅ + R13 S-1 专项 2/2 ✅；0 ⚠️ 偏离；0 ❌ 未实现）
- **三件套门禁复核（编排者实跑，Reviewer 信赖）**：
  - typecheck：`npx tsc --noEmit` exit 0，0 错误 ✅（impl-writer 自报 D8 query 类型扩展 `Record<string, string | number | string[] | undefined>` 后向兼容 + D11 ReportTable 动态列类型推导均 tsc 通过）
  - lint:rules：`node scripts/check-rules.mjs` exit 0，ARCH-003 + CODE 扫描器全过，META-003/META-004 持续闭合 ✅（R13 S-4 已让 CODE 扫描器覆盖前端 apps/web/src + apps/web/test，R15 新增 7 文件自动受约束）
  - test：`npx vitest run` exit 0，1089/1089（web 256 + api 833，无回归）✅（R15 web 新增 98 测试，1089 = R14 991 + R15 web +98；vitest.config.ts testTimeout 提升至 20000ms 适配 user.type 4001 字符）
- **ARCH-003 机器化结论**：**持续合规**——逐文件核对 R15 新增 7 文件 import 全部来自 `@admin/contracts` + 第三方（react/react-router-dom）+ apps/web 内部相对模块，0 处 `apps/api/src/**` 或 `@admin/api` 实际引用（grep 命中均为既有文件的 `[约束] ARCH-003` 注释文字，R15 新增文件无命中即无 apps/api/src 字样更无实际 import）。lint:rules ARCH-003 分支 + R13 S-4 CODE 扫描器自动覆盖新增前端文件 exit 0。
- **advisory 偏离反向同步状态**：impl-writer 自报 3 项（NotificationListPage option text 改英文枚举值避免与中文 status 单元格冲突 / ReportTable 动态列空值兜底空字符串 / NotificationForm + ReportFilter UUID_RE 客户端 advisory 校验）+ Reviewer 发现 5 项（api-notifications.test.ts L57 fixture recipient_id 含非 hex 'u' 用于 response body 非 safeParse 路径无影响但建议同步 / NotificationListPage PAGE_SIZE=20 常量化 / ReportPage appliedFilters 分页保持筛选可考虑 URL 持久化 / vitest testTimeout 全局生效可考虑 per-file / NotificationForm UUID_RE 与 ReportFilter UUID_RE 重复定义可提取）。均记 suggestion（R13 S-2 固化：纯 UI 文案/常量/UX 偏离不须同步 Spec §10 但须 Review 报告记录）。
- **①类显式影响核对结论**：**pass**——`git diff HEAD --stat -- apps/web/test/` 显示 R15 测试改动 4 处：(1) navigation.test.tsx ①类显式影响 R14 既有文件 it 标题 4→6 + 追加 2 条 Link 断言（通知/报表），根因 D17 Sidebar 扩展 6 入口；(2) notification-form.test.tsx ①类 setup 调整 VALID_UUID fixture `...0000u1`（非 hex）→ `...000001`（有效 hex），根因 createNotificationInputSchema z.string().uuid() 严格校验；(3) report-page.test.tsx ①类 setup 调整 checkGroupByDim helper 改用英文 dim regex + operator_id 输入值/断言同步 UUID，根因 ReportFilter advisory UUID_RE + getByLabelText(/实体类型/) 同时匹配 checkbox+select 歧义；(4) vitest.config.ts testTimeout 5000→20000，根因 user.type 4001 字符超时。判定：4 处改动均属合理 setup/matcher 调整，AI-002 边界 pass（matcher 文本改动但语义不弱化 + setup 调整有 contracts 严格校验/超时根因 + ①类显式影响注释标注完整）。
- **多[约束]组合副作用**：§10 末 8 条预判全部正确实现（通知 4 versioned + 409 重试 + 状态守卫 / group_by 数组 query + URLSearchParams / errorMapping 扩展 + SSOT / 状态机展示 + 隐藏按钮 / group_by 不预填 + advisory + 服务端兜底 / 动态列 + z.record / 混合表单 safeParse / client.ts query 扩展后向兼容）。
- **impl-writer 测试 setup 改动核对结论**：**pass**——4 处 setup/matcher 改动均合理（UUID hex 校准对齐 contracts z.string().uuid() 严格校验 + label 消歧对齐 getByLabelText 多匹配歧义 + testTimeout 提升不掩盖断言失败 + navigation 4→6 对齐 D17 扩展），无断言弱化，AI-002 边界 pass。
- **R14 S-11 同步注释闭合结论**：**pass**——errorMapping.ts L18-19 注释从"REPORT/NOTIFICATION/TRANSFER/ROLE_INHERITANCE 域保持 FALLBACK"更新为"R15 扩展后已移除 REPORT/NOTIFICATION 域的 FALLBACK，仅 TRANSFER/ROLE_INHERITANCE 域保持 FALLBACK"，L55 注释"未映射码（其余 TRANSFER/ROLE_INHERITANCE 域等本轮前端不触发）"，L72 函数注释"未映射码（TRANSFER/ROLE_INHERITANCE 域等）"——三处注释同步反映扩展后实际未映射域，R14 S-11 教训闭合。

## §1 PRD 验收逐条核对（AI-007，54 条 AC = 49 功能 + 3 ARCH-003 专项 + 2 R13 S-1 专项）

对照 PRD `docs/prd/web-notification-report.md` §验收标准（F1 通知列表 7 + F2 通知创建 6 + F3 通知编辑 5 + F4 通知发送 5 + F5 通知标记已读 4 + F6 通知删除 4 + F7 报表页 9 + F8 导航 3 + F9 错误处理 3 + F10 基础设施 3 = 49 功能 AC + ARCH-003 专项 3 + R13 S-1 专项 2 = 54），逐条核对实现行为是否对齐。测试覆盖两层：5 个新增 web 测试文件（2 API client 契约测 mock fetch + 3 组件测 jsdom + Testing Library）+ 2 个新增独立文件承接 ①类显式影响（navigation-extend.test.tsx、error-mapping-extend-2.test.ts）+ 1 处 R14 既有断言 matcher 调整（navigation.test.tsx 4→6）+ 1 处 R12 既有测试 D8 后向兼容核验（api-client.test.ts）。

### F1：通知列表页（7 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F1-1 | 首次加载 GET /v1/notifications?page=1&pageSize=20 + 渲染 | `NotificationListPage.tsx` PAGE_SIZE=20（D16）；useEffect listNotifications({page:1,pageSize:20})；渲染 title/recipient_id/status 文案 + 按 status 动态按钮 | `notification-list-page.test.tsx` 首次加载用例 + `api-notifications.test.ts` listNotifications 契约测 | ✅ |
| F1-2 | 分页切换 → GET page=2 | `NotificationListPage.tsx` handleNextPage/PrevPage → setPage | `notification-list-page.test.tsx` 分页用例 | ✅ |
| F1-3 | status 筛选 SSOT 派生（3 项） | `NotificationListPage.tsx` ALL_STATUSES = [...notificationStatusSchema.options]；STATUS_LABEL 中文化映射；select options 派生；query.status 传递 | `notification-list-page.test.tsx` status 筛选用例 + `api-notifications.test.ts` status=sent 契约测 + `error-mapping-extend-2.test.ts` SSOT 派生断言 | ✅ |
| F1-4 | 筛选+分页复合（R13 S-3） | `NotificationListPage.tsx` useEffect 依赖 [page, statusFilter]，翻页时筛选条件保留 | `notification-list-page.test.tsx` 组合场景用例 | ✅ |
| F1-5 | 空状态 → "暂无通知" | `NotificationListPage.tsx`（!loading && items.length===0 → "暂无通知"） | `notification-list-page.test.tsx` 空状态用例 | ✅ |
| F1-6 | 加载态 loading 文案 | `NotificationListPage.tsx`（loading && "加载中..."） | `notification-list-page.test.tsx` 加载态用例 | ✅ |
| F1-7 | status 文案中文化 + 按 status 动态显示按钮（Q3/Q11） | `NotificationListPage.tsx` STATUS_LABEL={draft:'草稿',sent:'已发送',read:'已读'}；按 status 条件渲染按钮：draft→编辑/发送/删除、sent→标记已读、read→无；option text 改用英文枚举值避免与中文 status 单元格冲突 | `notification-list-page.test.tsx` status 文案+按钮动态显示用例 | ✅ |

**F1 小结：7/7 ✅**。pageSize=20 显式传（D16，抹平契约缺省 10，N1）、status SSOT 派生（AI-005）、按 status 动态显示按钮（Q3 决策①隐藏不可用）、status 文案中文化（Q11 决策②）、option text 改英文避免与中文 status 单元格冲突均落地。

### F2：通知创建（自由文本表单 + safeParse，6 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F2-1 | 创建成功 → 弹窗关闭 + 列表刷新 | `NotificationForm.tsx` create 模式 createNotificationInputSchema.safeParse(raw) → createNotification → onCreated + onClose；`NotificationListPage.tsx` handleCreated → refresh() | `notification-form.test.tsx` 创建用例 + `api-notifications.test.ts` createNotification 契约测 | ✅ |
| F2-2 | title 空 → safeParse 拦截"通知标题必填" | `NotificationForm.tsx` createNotificationInputSchema.safeParse；!trimmedTitle → "通知标题必填" | `notification-form.test.tsx` title 空用例 | ✅ |
| F2-3 | title > 128 → safeParse 拦截"通知标题不超过 128 字符" | `NotificationForm.tsx` trimmedTitle.length > 128 → "通知标题不超过 128 字符" | `notification-form.test.tsx` title 超长用例 | ✅ |
| F2-4 | content 空/超长 → safeParse 拦截"通知内容必填"/"通知内容不超过 4000 字符" | `NotificationForm.tsx` content 校验 min(1).max(4000) | `notification-form.test.tsx` content 空/超长用例 | ✅ |
| F2-5 | recipient_id 非 uuid → safeParse 拦截"收件人 ID 须为 UUID 格式" | `NotificationForm.tsx` createNotificationInputSchema.recipient_id z.string().uuid() + UUID_RE 客户端 advisory 校验 | `notification-form.test.tsx` recipient_id 非 uuid 用例 | ✅ |
| F2-6 | create 仅 uuid 格式校验，存在性延后至 send（N4） | `NotificationForm.tsx` create 不触发 RECIPIENT_NOT_FOUND/RECIPIENT_DISABLED（仅 uuid 格式校验）；`api-notifications.test.ts` create 契约测不期望 RECIPIENT 码 | `notification-form.test.tsx` + `api-notifications.test.ts` | ✅ |

**F2 小结：6/6 ✅**。自由文本表单 safeParse 复用 createNotificationInputSchema（D4/R13 S-1）、recipient_id 仅 uuid 格式校验存在性延后至 send（N4 Q4 决策①）、UUID_RE 客户端 advisory 校验均落地。

### F3：通知编辑（仅 draft 态，PATCH versioned，自由文本 partial，5 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F3-1 | 编辑成功（draft 态，versioned） | `NotificationForm.tsx` edit 模式 diff initial → 仅提交变更字段（partial）→ updateNotificationInputSchema.safeParse(input) → updateNotification(id, input, expectedVersion) → onUpdated；`api/notifications.ts` updateNotification versioned=true + expectedVersion → client 注入 If-Match | `notification-form.test.tsx` 编辑用例 + `api-notifications.test.ts` updateNotification If-Match 契约测 | ✅ |
| F3-2 | sent/read 态拒绝编辑（NOTIFICATION_INVALID_TRANSITION） | `NotificationListPage.tsx` 按 status 隐藏编辑按钮（仅 draft 显示）；errorMapping NOTIFICATION_INVALID_TRANSITION='通知状态不允许此操作' | `notification-list-page.test.tsx` + `error-mapping-extend-2.test.ts` | ✅ |
| F3-3 | VERSION_CONFLICT 自动重试 1 次（用 current_version） | 复用 R12 client.ts D9 重试；`api/notifications.ts` updateNotification versioned=true 触发 client 409 重试路径 | `api-notifications.test.ts` updateNotification 409 重试用例 | ✅ |
| F3-4 | 重试仍 409 → "数据已被修改，请刷新后重试" | 复用 R12 client.ts 重试仅 1 次；errorMapping VERSION_CONFLICT='数据已被修改，请刷新后重试' | `api-notifications.test.ts` 重试仍冲突用例 | ✅ |
| F3-5 | 表单校验 partial（空对象合法）+ .strict() 拒多余字段 | `NotificationForm.tsx` edit 模式 updateNotificationInputSchema.safeParse（partial 空对象合法 + .strict() 拒多余字段如 status） | `notification-form.test.tsx` partial 编辑用例 | ✅ |

**F3 小结：5/5 ✅**。versioned PATCH 复用 R12 D9 重试策略（用 409 body current_version，不 GET 单条）、partial 编辑 diff initial 仅提交变更字段（对齐 updateNotificationInputSchema partial 语义）、sent/read 态前端按 status 隐藏编辑按钮（Q3 决策①）+ 后端 NOTIFICATION_INVALID_TRANSITION 兜底均落地。D7 [约束] 合规。

### F4：通知发送（POST send，draft→sent，versioned，类型派生操作，5 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F4-1 | 发送成功（类型派生操作，不调 safeParse） | `NotificationListPage.tsx` draft 行"发送"按钮 → sendNotification(id, version)（id/version 从列表派生，TS 类型保证，不调 safeParse）；`api/notifications.ts` sendNotification versioned=true + expectedVersion → client 注入 If-Match | `notification-list-page.test.tsx` 发送用例 + `api-notifications.test.ts` sendNotification If-Match 契约测 | ✅ |
| F4-2 | sent/read 态拒绝发送（NOTIFICATION_INVALID_TRANSITION） | `NotificationListPage.tsx` 按 status 隐藏发送按钮（仅 draft 显示） | `notification-list-page.test.tsx` + `error-mapping-extend-2.test.ts` | ✅ |
| F4-3 | VERSION_CONFLICT 自动重试 1 次 | 复用 R12 client.ts D9 重试 | `api-notifications.test.ts` sendNotification 409 重试用例 | ✅ |
| F4-4 | RECIPIENT_NOT_FOUND（N4 send 时延后校验） | errorMapping NOTIFICATION_RECIPIENT_NOT_FOUND='收件人不存在' | `notification-list-page.test.tsx` + `error-mapping-extend-2.test.ts` | ✅ |
| F4-5 | RECIPIENT_DISABLED（N4 send 时延后校验） | errorMapping NOTIFICATION_RECIPIENT_DISABLED='收件人已禁用' | `notification-list-page.test.tsx` + `error-mapping-extend-2.test.ts` | ✅ |

**F4 小结：5/5 ✅**。send versioned + If-Match（D7）、类型派生操作不调 safeParse（D5/R13 S-1/AC-ARCH-4）、RECIPIENT 延后校验在 send 时触发（N4 Q4 决策①）、409 重试复用 R12 D9 均落地。

### F5：通知标记已读（POST read，sent→read，versioned，类型派生操作，4 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F5-1 | 标记已读成功（类型派生操作，不调 safeParse） | `NotificationListPage.tsx` sent 行"标记已读"按钮 → markNotificationRead(id, version)；`api/notifications.ts` markNotificationRead versioned=true + expectedVersion → client 注入 If-Match | `notification-list-page.test.tsx` 标记已读用例 + `api-notifications.test.ts` markNotificationRead If-Match 契约测 | ✅ |
| F5-2 | draft 态拒绝标记已读（NOTIFICATION_INVALID_TRANSITION） | `NotificationListPage.tsx` 按 status 隐藏标记按钮（仅 sent 显示） | `notification-list-page.test.tsx` + `error-mapping-extend-2.test.ts` | ✅ |
| F5-3 | read 态拒绝重复标记（NOTIFICATION_INVALID_TRANSITION） | `NotificationListPage.tsx` read 行无操作按钮（Q3 决策①隐藏不可用） | `notification-list-page.test.tsx` + `error-mapping-extend-2.test.ts` | ✅ |
| F5-4 | VERSION_CONFLICT 自动重试 1 次 | 复用 R12 client.ts D9 重试 | `api-notifications.test.ts` markNotificationRead 409 重试用例 | ✅ |

**F5 小结：4/4 ✅**。markRead versioned + If-Match（D7）、类型派生操作不调 safeParse（D5/R13 S-1/AC-ARCH-4）、read 终态无操作按钮（Q3 决策① + Q11 决策②）、409 重试复用 R12 D9 均落地。

### F6：通知删除（DELETE，仅 draft，versioned，类型派生操作，4 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F6-1 | 删除成功（类型派生操作，不调 safeParse） | `NotificationListPage.tsx` draft 行"删除"按钮 → deleteNotification(id, version)；`api/notifications.ts` deleteNotification versioned=true + expectedVersion → client 注入 If-Match | `notification-list-page.test.tsx` 删除用例 + `api-notifications.test.ts` deleteNotification If-Match 契约测 | ✅ |
| F6-2 | sent/read 态拒绝删除（NOTIFICATION_INVALID_TRANSITION，append-only） | `NotificationListPage.tsx` 按 status 隐藏删除按钮（仅 draft 显示） | `notification-list-page.test.tsx` + `error-mapping-extend-2.test.ts` | ✅ |
| F6-3 | VERSION_CONFLICT 自动重试 1 次（DELETE 幂等） | 复用 R12 client.ts D9 重试（DELETE 幂等——重试发生在同次冲突未删成功的场景，409 表示未删除） | `api-notifications.test.ts` deleteNotification 409 重试幂等用例 | ✅ |
| F6-4 | NOTIFICATION_NOT_FOUND → "通知不存在" + 列表刷新 | `NotificationListPage.tsx` err.code==='NOTIFICATION_NOT_FOUND' → refresh()（移除已不存在行）；errorMapping NOTIFICATION_NOT_FOUND='通知不存在' | `notification-list-page.test.tsx` + `error-mapping-extend-2.test.ts` | ✅ |

**F6 小结：4/4 ✅**。delete versioned + If-Match（D7）、类型派生操作不调 safeParse（D5/R13 S-1/AC-ARCH-4）、DELETE 重试幂等（D9）、NOTIFICATION_NOT_FOUND 列表刷新（移除已不存在行）均落地。

### F7：报表页（纯读聚合，动态维度，9 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F7-1 | group_by 多维选择 SSOT 派生（4 项，checkbox） | `ReportFilter.tsx` ALL_GROUP_BY_DIMS = [...reportGroupByDimSchema.options]；checkbox group 单选 per 维自然去重；aria-label={dim}（英文）+ span"按X分组"消歧 | `report-page.test.tsx` group_by SSOT 派生用例 | ✅ |
| F7-2 | 时间范围筛选 datetime-local + ISO 归一 | `ReportFilter.tsx` normalizeDatetime（new Date(...).toISOString()）；"应用筛选"按钮触发请求（D12，R14 S-9 教训） | `report-page.test.tsx` 时间范围用例 | ✅ |
| F7-3 | operator_id 筛选（自由文本 uuid，advisory） | `ReportFilter.tsx` UUID_RE 客户端 advisory 校验 operator_id；"应用筛选"按钮触发请求（不每键入触发，R14 S-9 教训） | `report-page.test.tsx` operator_id 用例 + 非 uuid 拦截用例 | ✅ |
| F7-4 | entity_type + action 筛选 SSOT 派生（select） | `ReportFilter.tsx` ALL_ENTITY_TYPES = [...auditLogEntityTypeSchema.options]（5 项）；ALL_ACTIONS = [...auditLogActionSchema.options]（6 项）；select label 加"筛选"后缀消歧 | `report-page.test.tsx` entity_type/action SSOT 派生用例 | ✅ |
| F7-5 | 筛选+分页复合（R13 S-3） | `ReportPage.tsx` appliedFilters state，翻页时保持筛选条件；"应用筛选"按钮更新 appliedFilters | `report-page.test.tsx` 组合场景用例 | ✅ |
| F7-6 | group_by 缺省/空 → REPORT_GROUP_BY_REQUIRED（N5） | `ReportFilter.tsx` 客户端 advisory 校验 group_by 至少 1 维显示"请至少选择一个分组维度"不发请求（Q8 决策②不预填）；服务端兜底 REPORT_GROUP_BY_REQUIRED | `report-page.test.tsx` group_by 空拦截用例 + `api-reports.test.ts` 服务端码映射 + `error-mapping-extend-2.test.ts` | ✅ |
| F7-7 | operated_from > operated_to → REPORT_TIME_RANGE_INVALID（N5） | `ReportFilter.tsx` 客户端 advisory 校验 from <= to 显示"开始时间不能晚于结束时间"不发请求；服务端兜底 REPORT_TIME_RANGE_INVALID | `report-page.test.tsx` 时间范围反拦截用例 + 服务端兜底码组件层显示用例 | ✅ |
| F7-8 | 聚合结果表格动态列（N6，Q7 决策②） | `ReportTable.tsx` 据 `result.group_by` 遍历渲染列头（DIM_LABEL 中文化映射）+ count 固定列；`item[dim] !== undefined ? String(item[dim]) : ''` 兜底空字符串 | `report-page.test.tsx` 动态列渲染用例 | ✅ |
| F7-9 | 分页 + 空状态 + 加载态 | `ReportPage.tsx` "共 X 条，第 Y/Z 页"；空状态"暂无统计数据"；加载态"加载中..." | `report-page.test.tsx` 分页/空/加载用例 | ✅ |

**F7 小结：9/9 ✅**。group_by checkbox SSOT 派生（AI-005）、datetime-local ISO 归一（D14）、"应用筛选"按钮（D12，R14 S-9 教训闭合）、group_by 不预填（D13，Q8 决策②）、客户端 advisory 校验 + 服务端兜底（N5）、动态列渲染（D11，N6 Q7 决策②）、appliedFilters 分页保持筛选（R13 S-3）均落地。

### F8：导航扩展（3 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F8-1 | 侧边栏 6 入口 + 登出 | `Sidebar.tsx` 6 个 Link（用户/角色/部门/审计/通知/报表）+ 登出按钮（D17，4→6 扩展） | `navigation.test.tsx` 4→6 入口断言（①类显式影响）+ `navigation-extend.test.tsx` 6 入口断言 | ✅ |
| F8-2 | 入口可达（点击跳转渲染页面） | `Sidebar.tsx` Link to 对应路由；`App.tsx` 新增 /notifications /reports RouteGuard 包裹路由 | `navigation-extend.test.tsx` 入口跳转用例 | ✅ |
| F8-3 | 路由守卫覆盖新页（白名单仅 /login） | `App.tsx` /notifications /reports 均经 RouteGuard；R12 RouteGuard 白名单仅 /login 沿用 | `navigation-extend.test.tsx` 未登录跳 /login 用例 | ✅ |

**F8 小结：3/3 ✅**。侧边栏 6 入口扩展（D17）、路由守卫白名单仍仅 /login（R12 D13 沿用）、登出复用 R12 均落地。①类显式影响 navigation.test.tsx 4→6 调整见 §8。

### F9：错误处理（3 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F9-1 | 通知域码中文（NOTIFICATION_*） | `errorMapping.ts:47-50` NOTIFICATION_NOT_FOUND/NOTIFICATION_RECIPIENT_NOT_FOUND/NOTIFICATION_RECIPIENT_DISABLED/NOTIFICATION_INVALID_TRANSITION 中文提示，对齐 §11 矩阵 | `error-mapping-extend-2.test.ts` 通知域码用例 | ✅ |
| F9-2 | 报表域码中文（REPORT_*） | `errorMapping.ts:51-52` REPORT_GROUP_BY_REQUIRED/REPORT_TIME_RANGE_INVALID 中文提示，对齐 §11 矩阵 | `error-mapping-extend-2.test.ts` 报表域码用例 | ✅ |
| F9-3 | SSOT 派生 + R14 S-11 同步注释 + 401/网络错误复用 R12 | `errorMapping.ts:63-68` ERROR_MESSAGES = Object.fromEntries([...errorCodeSchema.options].map(...))，键仍从 SSOT 派生（R12 D11 沿用）；L18-19/L55/L72 注释同步反映扩展后实际未映射域（TRANSFER/ROLE_INHERITANCE）；R12 client.ts D8 401 拦截 + NETWORK_ERROR 兜底沿用 | `error-mapping-extend-2.test.ts` SSOT 派生断言 + R14 S-11 同步注释核验（TRANSFER/ROLE_INHERITANCE FALLBACK）+ R12/R14 既有码不破坏 | ✅ |

**F9 小结：3/3 ✅**。errorMapping 扩展 SPECIFIC_MESSAGES（D9，6 码通知+报表）、SSOT 派生机制保留（R12 D11 沿用）、R14 S-11 同步注释闭合（三处注释更新反映 TRANSFER/ROLE_INHERITANCE 域 FALLBACK）、401 拦截/网络兜底复用 R12 均落地。

### F10：前端基础设施复用（3 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F10-1 | API client 复用（经 request() 不直连 fetch） | `api/notifications.ts`/`api/reports.ts` 均 import request from './client.js'，pages/components 不直连 fetch | `api-notifications.test.ts` + `api-reports.test.ts` | ✅ |
| F10-2 | Bearer/If-Match 注入复用 | R12 client.ts D6 Bearer + D7 If-Match 沿用；R15 4 versioned 端点（update/send/markRead/delete）全部触发 If-Match 注入 | `api-notifications.test.ts` Bearer/If-Match 断言（4 端点）+ `api-client.test.ts` R12 既有断言 D8 扩展后不失效 | ✅ |
| F10-3 | 零新依赖 | `apps/web/package.json` R12/R14 依赖清单沿用，R15 无新增 dependencies/devDependencies | `navigation-extend.test.tsx` 工程核验 | ✅ |

**F10 小结：3/3 ✅**。API client 复用 R12（零新增基础设施）、Bearer/If-Match 注入复用、零新依赖（无 axios/ky/Redux/Zustand/UI 框架/Playwright/图表库）均落地。

### ARCH-003 合规专项（3 条）

| # | PRD 验收点 | 实现行为 | 测试/校验覆盖 | 对齐 |
|---|---|---|---|---|
| ARCH-1 | 新增模块不直连后端 | grep `apps/api/src\|@admin/api` in apps/web/src：命中均为既有文件 `[约束] ARCH-003` 注释文字，R15 新增 7 文件 0 命中（无 apps/api/src 字样更无实际 import） | lint:rules ARCH-003 分支 exit 0 + Reviewer 逐文件核对 | ✅ |
| ARCH-2 | 类型来自 contracts | R15 新增模块全部 import type from '@admin/contracts'（Notification/NotificationStatus/CreateNotificationInput/UpdateNotificationInput/ListNotificationQuery/NotificationListResult/ReportQuery/ReportResult/ReportGroupByDim/ReportAggItem/AuditLogEntityType/AuditLogAction/ErrorCode 等）；0 手写 TS 类型副本 | tsc 0 错误 + API client 契约测类型断言 | ✅ |
| ARCH-3 | 客户端校验复用契约 schema（自由文本表单） | `NotificationForm.tsx` create 模式 createNotificationInputSchema.safeParse（覆盖 title/content/recipient_id 整体校验 + .strict()）；edit 模式 updateNotificationInputSchema.safeParse（partial + .strict()）；ReportFilter operated_from/operated_to/operator_id 客户端字段 advisory 校验 | `notification-form.test.tsx` safeParse 拦截断言 + `report-page.test.tsx` advisory 校验断言 | ✅ |

**ARCH-003 小结：3/3 ✅**。R12 机器化 enforcement 持续覆盖新增 7 文件、类型 z.infer 派生、自由文本表单 safeParse（D4）、D8 client.ts query 类型扩展后向兼容（string[] 不破坏 number 既有断言）均落地。

### R13 S-1 合规专项（2 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| S1-1 | 自由文本表单须 safeParse | `NotificationForm.tsx` create 模式 createNotificationInputSchema.safeParse（title/content/recipient_id 自由文本）；edit 模式 updateNotificationInputSchema.safeParse（partial 自由文本）；`ReportFilter.tsx` operated_from/operated_to/operator_id 客户端字段 advisory 校验（reportQuerySchema 非 strict 且含 superRefine，前端表单按字段分别校验） | `notification-form.test.tsx` safeParse 拦截用例 + `report-page.test.tsx` advisory 校验用例 | ✅ |
| S1-2 | 类型派生操作 TS 类型保证 | `NotificationListPage.tsx` send/markRead/delete 按钮（id/version 从列表派生，Notification.id 为 uuid 字面量 TS 类型保证，version 为 number 字面量）；`ReportFilter.tsx` group_by checkbox（options 从 [...reportGroupByDimSchema.options] SSOT 派生，值 ∈ 枚举编译期保证）+ entity_type/action select（options 从 [...auditLogEntityTypeSchema.options]/[...auditLogActionSchema.options] SSOT 派生） | `notification-list-page.test.tsx` 类型派生断言 + `report-page.test.tsx` SSOT 派生断言 | ✅ |

**R13 S-1 小结：2/2 ✅**。R13 S-1 在状态机/聚合域下落地：自由文本表单（NotificationForm create/edit、ReportFilter operated_from/operated_to/operator_id）调 safeParse 或客户端字段 advisory 校验；类型派生操作（NotificationListPage send/markRead/delete 按钮、ReportFilter group_by checkbox/entity_type/action select）值经 TS 类型/SSOT 派生保证合法，不强制 safeParse。**NotificationForm 混合表单按 §3.2 提示处理：整体 createNotificationInputSchema.safeParse 覆盖 title/content/recipient_id 自由文本，recipient_id 字段值经 UUID_RE advisory 校验 + safeParse uuid 格式校验双重保证**。

### AI-007 PRD 逐条核对总结

- F1 通知列表 7/7 ✅ + F2 创建 6/6 ✅ + F3 编辑 5/5 ✅ + F4 发送 5/5 ✅ + F5 标记已读 4/4 ✅ + F6 删除 4/4 ✅ + F7 报表 9/9 ✅ + F8 导航 3/3 ✅ + F9 错误 3/3 ✅ + F10 基础设施 3/3 ✅ = **功能 49/49 ✅**
- ARCH-003 专项 **3/3 ✅**（ARCH-3 自由文本表单 safeParse 完全对齐）
- R13 S-1 专项 **2/2 ✅**
- **合计 54/54 ✅ + 0 ⚠️ + 0 ❌**

**AI-007 是否生效**：✅ **生效**。7 测试文件对照 PRD F1-F10 + ARCH-003 + R13 S-1 每条 Given/When/Then 产出断言（含 mock fetch 验 API client 行为 + jsdom 组件测验交互 + 动态列渲染断言 + SSOT 派生断言）。Reviewer 逐条核对实现行为对齐，0 ❌ 未实现，0 ⚠️ 偏离。

## §2 规则合规审查

### AI 系列（spec-first 工作流）

| 规则 | 要求 | 实现核查 | 结论 |
|---|---|---|---|
| AI-001 | 先读 Spec 再写码 | R15 实现严格对齐 Tech-Spec §2~§12（分层/契约消费/API client 复用/状态管理/路由/页面组件/错误矩阵）；每文件头注释引用 TECH-WEB-NOTIFICATION-REPORT-001 章节号 | ✅ 合规 |
| AI-002 | 测试先行，impl-writer 禁改测试断言（仅可改 setup/import 路径并注明理由） | `git diff HEAD --stat -- apps/web/test/` 显示 R15 测试改动 4 处：(1) navigation.test.tsx ①类显式影响 R14 既有 it 标题 4→6 + 追加 2 条 Link 断言；(2) notification-form.test.tsx ①类 setup 调整 VALID_UUID fixture 非hex→有效hex；(3) report-page.test.tsx ①类 setup 调整 checkGroupByDim helper 英文 regex + operator_id UUID 同步；(4) vitest.config.ts testTimeout 5000→20000。**边界判定**：4 处改动均属合理 setup/matcher 调整，根因是 contracts z.string().uuid() 严格校验 / getByLabelText 多匹配歧义 / user.type 4001 字符超时 / D17 扩展 4→6 入口，matcher 文本改动但语义不弱化 + setup 调整有 contracts/超时根因 + ①类显式影响注释标注完整。详见 §8 ①类显式影响专项 | ✅ 合规（边界 pass） |
| AI-003 | advisory 偏离须反向同步 Spec；[约束] 偏离须显式标注+反向同步+Reviewer 确认 | D8 client.ts query 类型扩展 + D9 errorMapping 扩展 + D12 应用筛选按钮 + D13 group_by 不预填 + D14 datetime-local ISO 归一 + D17 侧边栏 6 入口均同步 Spec §10 ✅；8 项纯 UI 文案/常量/UX advisory 偏离均记 suggestion（R13 S-2 固化：纯 UI 文案偏离不须同步 Spec §10 但须 Review 报告记录） | ⚠️ suggestion（8 项 advisory 偏离记录见 §4） |
| AI-004 | 每次改动必跑三件套 | 编排者实跑 typecheck 0 错误 + lint:rules exit 0 + vitest 1089/1089 | ✅ 合规 |
| AI-005 | 跨域可变集合用 SSOT 派生断言 | `errorMapping.ts:63` `[...errorCodeSchema.options]` SSOT 派生映射表键；`NotificationListPage.tsx` `[...notificationStatusSchema.options]` SSOT 派生 status 选项；`ReportFilter.tsx` `[...reportGroupByDimSchema.options]`/`[...auditLogEntityTypeSchema.options]`/`[...auditLogActionSchema.options]` SSOT 派生 group_by/entity_type/action 选项；`error-mapping-extend-2.test.ts:29` `[...errorCodeSchema.options]` SSOT 派生测试断言 | ✅ 合规 |
| AI-006 | Tech Lead 须产出受影响测试清单 | Tech-Spec §9 三类标注完整（①类 1~2 显式边缘：navigation.test.tsx + error-mapping-extend.test.ts / 0 隐式 / ②类 0 / ③类 5 文件预估 + 2 ①类显式影响新文件）；test-writer 实际新增 5 文件 + 2 ①类显式影响新文件（navigation-extend.test.tsx、error-mapping-extend-2.test.ts）+ 1 处 R14 navigation.test.tsx ①类显式影响调整 + 1 处 R12 api-client.test.ts D8 后向兼容核验。test-writer 反向核实：识别 ①类显式影响（navigation 4→6）已在 navigation-extend.test.tsx 注释中列出 | ✅ 合规 |
| AI-007 | 端到端验收 + Reviewer PRD 逐条核对 | 7 测试文件覆盖 + Reviewer 54 条 AC 逐条核对（§1） | ✅ 合规 |

### ARCH 系列（分层）

| 规则 | 要求 | 实现核查 | 结论 |
|---|---|---|---|
| ARCH-001 | 后端单向依赖 router→service→repo→domain | 前端不触后端；既有 ARCH-001 扫描器（allTs 含 apps/api/src）exit 0 | ✅ 合规（前端无关，既有验证） |
| ARCH-002 | contracts 纯净 | 前端不触 contracts；R15 契约层零新增（PRD 明示 contracts 已就绪，通知/报表契约在 R6/R9 冻结）；ARCH-002 扫描器 exit 0 | ✅ 合规 |
| ARCH-003 | 跨层只经契约（前端禁 import 后端模块） | **逐文件核对**：R15 新增 7 文件 import 全部来自 `@admin/contracts` + 第三方（react/react-router-dom）+ apps/web 内部相对模块（`./`、`../`）；0 处 `apps/api/src/**` 或 `@admin/api` 实际引用。grep `apps/api/src\|@admin/api` in apps/web/src：命中均为既有文件 `[约束] ARCH-003` 注释文字，R15 新增文件 0 命中。lint:rules ARCH-003 分支 + R13 S-4 CODE 扫描器自动覆盖新增文件 exit 0 | ✅ 合规（持续合规，详见 §7） |

### CODE 系列（命名/禁用模式，R13 S-4 已让 CODE 扫描器覆盖前端）

| 规则 | 要求 | 实现核查 | 结论 |
|---|---|---|---|
| CODE-001 | 禁止 any | R13 S-4 CODE-001 扫描器覆盖 apps/web/src + apps/web/test；lint:rules exit 0。手动核对 R15 新增文件：0 处 `: any` 或 `as any`；ReportTable 动态列 `item[dim]` 经 z.record 派生类型为 `string \| number`，用 `String(item[dim])` 安全转换 | ✅ 合规（机器化覆盖 + 手动核对） |
| CODE-002 | 禁止空 catch / 仅 console catch | R13 S-4 CODE-002 扫描器覆盖前端；lint:rules exit 0。手动核对 R15 新增文件：catch 块均含 setError/refresh 语义处理，0 空 catch | ✅ 合规 |
| CODE-003 | 禁止 eval / new Function | R13 S-4 CODE-003 扫描器覆盖前端；lint:rules exit 0。手动核对：0 处 eval/new Function | ✅ 合规 |
| CODE-004 | Zod schema 命名后缀 Schema | 前端不定义 Zod schema（全部复用 contracts），N/A；R13 S-4 CODE-004 扫描器覆盖前端 exit 0 | ✅ 合规（N/A） |

> **R13 S-4 闭合状态**：R13 S-4 已让 CODE 扫描器覆盖前端 apps/web/src + apps/web/test。R15 新增 7 前端文件自动受 CODE-001/002/003/004/AI-005 扫描器覆盖，lint:rules exit 0。

### SEC 系列（鉴权/PII）

| 规则 | 要求 | 实现核查 | 结论 |
|---|---|---|---|
| SEC-001 | 路由声明式 auth 元数据 | 前端为客户端路由（React Router），非后端 procedure；SEC-001 适用于后端 router（R11 已验证）。前端 RouteGuard 实现客户端鉴权拦截，R15 新增 /notifications /reports 经 RouteGuard | ✅ 合规（前端 N/A，后端既有验证） |
| SEC-002 | service 层越权校验（逐个 public 方法独立核对） | 前端无 service 层；SEC-002 适用于后端（R6 通知 service + R11 markRead 自服务 SEC-002-exempt 已逐方法核对）。R15 后端冻结不改 service，SEC-002 既有验证沿用。**Reviewer 逐个 public 方法独立核对**：R15 不改后端 service，NotificationService/ReportService 既有方法鉴权沿用 R6/R11 验证（NotificationService.markRead 标 SEC-002-exempt: recipient self-service PRD Q4b，已 R11 核验），无新增 public 方法须核对 | ✅ 合规（前端 N/A，后端既有验证 + 逐方法核对沿用 R6/R11） |
| SEC-003a | 响应不返回未声明 PII（输出 schema .strict()） | 前端消费 notificationSchema/reportAggItemSchema（均 .strict()）；通知/报表域无 PII 字段（contracts 明示 title/content 为业务文本、recipient_id 为 uuid 引用、report 纯计数），R15 不引入新 PII 处理面 | ✅ 合规 |
| SEC-003b | 错误消息与日志 PII 边界（password/token 不入日志 + 审计 before-after PII 脱敏） | **重点核对**：(1) 通知/报表域无 PII 字段，title/content/recipient_id/count/维度值均非 PII，前端展示/输入无特殊脱敏处理；(2) password 不入日志——R15 无登录表单改动，沿用 R12；(3) token 不入日志——R15 沿用 R12 tokenStore；(4) operator_id（报表 group_by 维度值）禁止 console.log——R15 新增文件 0 console.log 调用（grep 确认）；(5) 通知/报表域无 auditLogSchema 消费（沿用 R14 审计 PII 脱敏态处理） | ✅ 合规 |

### META 系列（规则元数据）

| 规则 | 要求 | 实现核查 | 结论 |
|---|---|---|---|
| META-001 | 规则文档须含"校验方式"段 + 机器校验关键词 | layering.md ARCH-003 块含"校验方式"段 + `check-rules.mjs ARCH-003 分支` 关键词；META-001 扫描器 exit 0 | ✅ 合规 |
| META-002 | 规则 PR 准入（rules 改动须同 PR 含 check-rules.mjs 改动） | R15 无规则文件改动（R12 已落地 ARCH-003 分支 + R13 S-4 已扩展 allTs 含前端），layering.md/check-rules.mjs 无改动 | ✅ 合规（R15 无规则改动） |
| META-003 | 声明即实现（规则声称用 check-rules.mjs 专属分支 → 脚本有 markEnforcement） | layering.md ARCH-003 校验方式含"check-rules.mjs ARCH-003 分支"措辞 ↔ check-rules.mjs markEnforcement('ARCH-003')；META-003 扫描器 exit 0 | ✅ 合规（闭合） |
| META-004 | 实现即声明（脚本 markEnforcement → 规则文档有对应规则 ID 块） | check-rules.mjs markEnforcement('ARCH-003') ↔ layering.md `## ARCH-003` 块存在；META-004 扫描器 exit 0 | ✅ 合规（闭合） |

**META-003/META-004 双向绑定闭合结论**：R12 已闭合，R15 无规则改动，双向绑定持续闭合。

## §3 语义审查（重点项逐个分析）

### 重点项 1：BA 核验 N1-N6 是否遵循契约 SSOT

| # | BA 核验点 | 实现遵循 | 结论 |
|---|---|---|---|
| N1 | 通知 pageSize 缺省 10（与 audit/report 域 20 分歧），前端显式传 20 | `NotificationListPage.tsx` PAGE_SIZE=20 显式传（D16）；`api/notifications.ts` listNotifications 调用方显式传 pageSize=20；`api-notifications.test.ts` listNotifications({page:1,pageSize:20}) 契约测断言 query 含 pageSize=20 | ✅ 遵循 |
| N2 | updateNotificationInputSchema partial（空对象合法），状态守卫 NOTIFICATION_INVALID_TRANSITION | `NotificationForm.tsx` edit 模式 diff initial → 仅提交变更字段（partial），updateNotificationInputSchema.safeParse(input)；sent/read 态编辑被前端按 status 隐藏 + 后端 NOTIFICATION_INVALID_TRANSITION 兜底 | ✅ 遵循 |
| N3 | send/markRead/delete 均 versioned（server.ts L359/364/369 第 5 参 true） | `api/notifications.ts` sendNotification/markNotificationRead/deleteNotification 全部 versioned=true + expectedVersion；`api-notifications.test.ts` 4 端点 If-Match 注入断言 | ✅ 遵循 |
| N4 | recipient_id 仅 uuid 格式校验，存在性/禁用态延后至 send | `NotificationForm.tsx` create 模式 createNotificationInputSchema.recipient_id z.string().uuid() + UUID_RE advisory 校验，create 不触发 RECIPIENT_NOT_FOUND/RECIPIENT_DISABLED；send 时触发（AC-F4-4/F4-5） | ✅ 遵循 |
| N5 | group_by 缺省/空由 service 层 → REPORT_GROUP_BY_REQUIRED；operated_from > operated_to → REPORT_TIME_RANGE_INVALID | `ReportFilter.tsx` 客户端 advisory 校验 group_by 至少 1 维 + from <= to；服务端兜底 REPORT_GROUP_BY_REQUIRED/REPORT_TIME_RANGE_INVALID；`api-reports.test.ts` 服务端码映射契约测 | ✅ 遵循 |
| N6 | reportAggItemSchema z.record 动态维度键 + reportResultSchema.group_by 原样回显 | `ReportTable.tsx` 据 `result.group_by` 遍历渲染列头 + count 固定列；`item[dim]` 运行时取值（z.record 类型保证 string|number） | ✅ 遵循 |

**N1-N6 小结**：6/6 ✅ 全部遵循 contracts SSOT。PRD BA 核验发现的 6 处须 AC 精确断言点（pageSize 缺省分歧 / partial 状态守卫 / 4 versioned 端点 / recipient 延后校验 / group_by 服务端兜底 / 动态维度键）均以 contracts SSOT 为准，Tech-Spec + impl 实现一致遵循。

### 重点项 2：D8 client.ts query 类型扩展支持 string[]（repeated key）是否正确

**实现位置**：`apps/web/src/api/client.ts`
```ts
export type RequestOptions = {
  body?: unknown;
  query?: Record<string, string | number | string[] | undefined>;  // + string[]
  versioned?: boolean;
  expectedVersion?: number;
  skipAuth?: boolean;
};

function buildUrl(path, query) {
  // ...
  if (Array.isArray(value)) {
    for (const v of value) params.append(key, String(v));  // repeated key
  } else {
    params.append(key, String(value));
  }
}
```

**判定**：✅ **正确**
- query 类型扩展 `string | number | string[] | undefined`（+ string[]），对齐 server.ts L341 `m.query.getAll('group_by')` repeated key 语义。
- buildUrl 对 Array.isArray 分支逐元素 append（repeated key `?group_by=A&group_by=B`），空数组跳过，string/number/undefined 行为不变（后向兼容）。
- **后向兼容核验**：R12 既有 `api-client.test.ts:215-217` RequestOptions 断言 `query: { page: 1 }`（number 类型），D8 扩展后 number 仍支持，既有断言不失效（编排者实跑 1089/1089 全绿）。
- `api/reports.ts` queryOperations(query) 传 `group_by: ReportGroupByDim[]`，client buildUrl 拼接为 `?group_by=operator_id&group_by=date` repeated key。
- 409 重试仅匹配 `code === 'VERSION_CONFLICT'`，INVALID_TRANSITION 不重试（多约束组合 #1 闭合）。

### 重点项 3：D9 errorMapping 扩展是否覆盖通知/报表码 + R14 S-11 同步注释闭合

**实现位置**：`apps/web/src/lib/errorMapping.ts:21-53`

**判定**：✅ **正确**
- **通知域码**（L47-50）：NOTIFICATION_NOT_FOUND/NOTIFICATION_RECIPIENT_NOT_FOUND/NOTIFICATION_RECIPIENT_DISABLED/NOTIFICATION_INVALID_TRANSITION 中文提示，对齐 §11 矩阵 ✅。
- **报表域码**（L51-52）：REPORT_GROUP_BY_REQUIRED/REPORT_TIME_RANGE_INVALID 中文提示，对齐 §11 矩阵 ✅。
- **SSOT 派生机制保留**（L63-68）：ERROR_MESSAGES = Object.fromEntries([...errorCodeSchema.options].map(...))，键仍从 SSOT 派生（R12 D11 沿用，AC-F9-3）✅。
- **errorCodeSchema 枚举未扩展**：通知/报表码本就在 errorCodeSchema 全集内（contracts user.ts 已核验），非新增枚举键，SSOT 派生断言不失效 ✅。
- **R14 S-11 同步注释闭合**（三处注释更新）：
  - L18-19：`[advisory] TRANSFER/ROLE_INHERITANCE 域码本期前端不触发，保持 FALLBACK。（R14 S-11 同步注释：R15 扩展后已移除 REPORT/NOTIFICATION 域的 FALLBACK，仅 TRANSFER/ROLE_INHERITANCE 域保持 FALLBACK。）` ✅
  - L55：`未映射码（其余 TRANSFER/ROLE_INHERITANCE 域等本轮前端不触发）通用提示。` ✅
  - L72：`未映射码（TRANSFER/ROLE_INHERITANCE 域等）返回通用"操作失败，请稍后重试"（AC-F7-2）。` ✅
- **R14 既有码不破坏**：R12/R14 既有码（INVALID_CREDENTIALS/VERSION_CONFLICT/USER_NOT_FOUND/ROLE_NOT_FOUND/DEPT_NOT_FOUND 等）保留，`error-mapping-extend-2.test.ts` 既有码不破坏断言全绿 ✅。
- 测试覆盖：`error-mapping-extend-2.test.ts` 通知域码 + 报表域码 + SSOT 派生 + R14 S-11 同步注释核验（TRANSFER/ROLE_INHERITANCE FALLBACK）+ R12/R14 既有码不破坏断言。

> **①类显式影响预估不失效核验**：R14 既有 `error-mapping-extend.test.ts` 断言 ROLE/DEPT/AUDIT/INVALID_CREDENTIALS/VERSION_CONFLICT 码（不断言 NOTIFICATION/REPORT 码 → FALLBACK），R15 扩展 SPECIFIC_MESSAGES 后 R14 既有断言不失效（编排者实跑 1089/1089 全绿）。test-writer 在 `error-mapping-extend-2.test.ts` 注释中已标注此预估，impl-writer 据此 double-check。详见 §8。

### 重点项 4：通知 4 versioned 端点 If-Match + 409 重试（复用 R12 D9）是否正确

**实现位置**：`apps/web/src/api/notifications.ts`

**判定**：✅ **正确**
- 4 个 versioned 端点（updateNotification/sendNotification/markNotificationRead/deleteNotification）全部 `versioned: true, expectedVersion` → client 注入 If-Match（R12 D7 沿用）。
- 409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条，R12 D9 沿用）。
- 重试仍 409 抛 ApiError → errorMapping VERSION_CONFLICT='数据已被修改，请刷新后重试'。
- **INVALID_TRANSITION 不重试**：client 仅对 VERSION_CONFLICT 重试，NOTIFICATION_INVALID_TRANSITION（409 但非 VERSION_CONFLICT）抛 ApiError 由调用方处理（多约束组合 #1 闭合）。
- **DELETE 重试幂等**：重试发生在同次冲突未删成功的场景（409 表示未删除），重试 DELETE 语义安全（多约束组合 #1 闭合）。
- 测试覆盖：`api-notifications.test.ts` 4 端点 If-Match 注入 + 4 端点 409 重试 + 重试仍冲突 + Bearer token 注入断言。

### 重点项 5：D11 ReportTable 动态列渲染（z.record 动态维度键）是否正确

**实现位置**：`apps/web/src/components/ReportTable.tsx`

**判定**：✅ **正确**
- 据 `result.group_by` 遍历渲染列头（DIM_LABEL 中文化映射 operator_id→操作者/entity_type→实体类型/action→动作/date→日期）+ count 固定列。
- 每行 item 据 dim key 取值：`item[dim] !== undefined ? String(item[dim]) : ''` 兜底空字符串（z.record 类型保证 string|number，String() 安全转换）。
- group_by 变化时列头动态更新（如选 ['entity_type','action'] 则列头为"实体类型"+"动作"+"计数"）。
- **类型安全**：ReportAggItem 为 `Record<string, string|number> & {count: number}`，dim key 为 string，TS 不强制具体键名，运行时遍历 `result.group_by` 渲染（对齐 N6 Q7 决策②动态列）。
- 测试覆盖：`report-page.test.tsx` 动态列渲染用例（group_by=['operator_id','date'] 列头断言）。

### 重点项 6：D12 报表"应用筛选"按钮（R14 S-9 教训闭合）是否正确

**实现位置**：`apps/web/src/components/ReportFilter.tsx` + `apps/web/src/pages/ReportPage.tsx`

**判定**：✅ **正确**
- ReportFilter 含"应用筛选"按钮，点击触发 onSubmit（提交筛选条件）。
- ReportPage appliedFilters state，"应用筛选"按钮更新 appliedFilters → 触发请求；翻页时保持 appliedFilters（R13 S-3 组合场景）。
- **不每键入触发请求**（R14 S-9 教训闭合）：operator_id 文本输入 + datetime-local 切换均经"应用筛选"按钮原子提交，无须 debounce。
- 客户端 advisory 校验（group_by 非空 + from <= to + operator_id uuid 格式）在"应用筛选"按钮 onClick 内执行，校验失败不发请求。
- 测试覆盖：`report-page.test.tsx` 应用筛选用例 + advisory 拦截用例。

### 重点项 7：D13 group_by 不预填默认维度（Q8 决策②）是否正确

**实现位置**：`apps/web/src/components/ReportFilter.tsx`

**判定**：✅ **正确**
- group_by 默认不勾选任何维度（Q8 决策②不预填）。
- 客户端 advisory 校验 group_by 至少 1 维，显示"请至少选择一个分组维度"不发请求。
- 服务端兜底 REPORT_GROUP_BY_REQUIRED（若客户端未拦截直接请求）。
- **不预填让用户显式选择**：预填默认维度会掩盖"必选"语义，用户可能直接应用筛选触发默认维度非其本意。
- 测试覆盖：`report-page.test.tsx` group_by 空拦截用例 + `api-reports.test.ts` 服务端码映射。

### 重点项 8：D14 datetime-local + ISO 归一是否正确

**实现位置**：`apps/web/src/components/ReportFilter.tsx` normalizeDatetime

**判定**：✅ **正确**
- datetime-local 原生输入，前端归一为 ISO 8601 datetime（new Date(...).toISOString()，如 `2026-07-03T12:00:00.000Z`）。
- 对齐 R14 审计 Q7 决策① datetime-local + ISO 归一，跨域前端一致。
- 归一逻辑属 advisory 实现提示（R13 S-2 不须同步 Spec §10 但须 Review 报告记录）。
- 测试覆盖：`report-page.test.tsx` 时间范围用例断言 operated_from/operated_to 含 ISO 字符串。

### 重点项 9：R13 S-1 区分两类表单（NotificationForm safeParse vs NotificationListPage/ReportFilter 类型派生）

**判定**：✅ **正确**
- **自由文本表单（须 safeParse，D4）**：
  - `NotificationForm.tsx` create 模式 createNotificationInputSchema.safeParse（覆盖 title 1..128 + content 1..4000 + recipient_id uuid + .strict() 拒多余字段）。
  - `NotificationForm.tsx` edit 模式 updateNotificationInputSchema.safeParse（partial + .strict()）。
  - `ReportFilter.tsx` operated_from/operated_to/operator_id 客户端字段 advisory 校验（reportQuerySchema 非 strict 且含 superRefine，前端表单按字段分别校验）。
- **类型派生操作（TS 类型保证，safeParse 冗余，D5）**：
  - `NotificationListPage.tsx` send/markRead/delete 按钮（id/version 从列表派生，Notification.id 为 uuid 字面量 TS 类型保证，version 为 number 字面量）。
  - `ReportFilter.tsx` group_by checkbox（options 从 [...reportGroupByDimSchema.options] SSOT 派生，值 ∈ 枚举编译期保证）。
  - `ReportFilter.tsx` entity_type/action select（options 从 [...auditLogEntityTypeSchema.options]/[...auditLogActionSchema.options] SSOT 派生）。
- **NotificationForm 混合表单**（§3.2 提示）：整体 createNotificationInputSchema.safeParse 覆盖 title/content/recipient_id 自由文本，recipient_id 字段值经 UUID_RE advisory 校验 + safeParse uuid 格式校验双重保证。
- **AC-ARCH-4 完全对齐**：impl 显式标注类型派生操作不调 safeParse + 理由（D5 [约束] + R13 S-1 固化）。

### 重点项 10：多约束组合副作用 8 条是否全部规避

详见 §9 多[约束]组合副作用核对。8 条预判全部正确实现，无副作用 bug。

## §4 advisory 偏离核对（AI-003 / R13 S-2 固化）

### impl-writer 自报 3 项 + Reviewer 发现 5 项

| # | 偏离项 | Spec 预判/同步状态 | 判定 |
|---|---|---|---|
| 1 | **NotificationListPage option text 改用英文枚举值**（避免与中文 status 单元格冲突） | `NotificationListPage.tsx` status 筛选 select option text 改用英文枚举值（draft/sent/read）而非中文（草稿/已发送/已读），避免 getByLabelText(/草稿/) 等同时匹配 select option + 中文 status 单元格。**对齐 AC-F1-3**（status 筛选生效）+ AC-F1-7（status 文案中文化在单元格展示，非 select option）。**Tech-Spec §10 未列此项**（纯 UI label 文案，R13 S-2 不须同步 Spec §10 但须 Review 报告记录） | ⚠️ **合理偏离（纯 UI label 文案）**——S-1。功能不弱化（筛选生效 + status 文案中文化在单元格） |
| 2 | **ReportTable 动态列空值兜底空字符串** | `ReportTable.tsx` `item[dim] !== undefined ? String(item[dim]) : ''` 兜底空字符串。**对齐 AC-F7-8**（动态列渲染）。**Tech-Spec §10 未列此项**（纯 UI 兜底展示，R13 S-2 不须同步 Spec §10 但须 Review 报告记录） | ⚠️ **合理偏离（纯 UI 兜底）**——S-2。功能不弱化（动态列渲染 + 空值兜底不报错） |
| 3 | **NotificationForm + ReportFilter UUID_RE 客户端 advisory 校验** | `NotificationForm.tsx` + `ReportFilter.tsx` 均定义 UUID_RE 正则做客户端 advisory 校验（createNotificationInputSchema.recipient_id z.string().uuid() + ReportFilter operator_id advisory）。**对齐 AC-F2-5**（recipient_id 非 uuid 拦截）+ AC-F7-3（operator_id 非 uuid advisory 拦截）。**Tech-Spec §10 未列此项**（advisory 客户端校验，R13 S-2 不须同步 Spec §10 但须 Review 报告记录） | ⚠️ **合理偏离（advisory 客户端校验）**——S-3。功能不弱化（双重校验保证 uuid 格式） |
| 4 | **api-notifications.test.ts L57 fixture recipient_id 含非 hex 'u'**（Reviewer 发现） | `api-notifications.test.ts:57` makeNotification fixture `recipient_id: '00000000-0000-4000-8000-0000000000u1'` 含非 hex 字符 'u'。**用于 response body 非 safeParse 路径**（mock fetch 返回值，不经 createNotificationInputSchema.safeParse 校验），无影响。但与 notification-form.test.tsx VALID_UUID 改为有效 hex UUID（...000001）不一致。**Tech-Spec §10 未列此项** | ⚠️ **合理偏离（fixture 一致性）**——S-4。功能不弱化（response body 非 safeParse 路径无影响），建议同步改为有效 hex UUID 保持一致性 |
| 5 | **NotificationListPage PAGE_SIZE=20 常量化**（Reviewer 发现） | `NotificationListPage.tsx` PAGE_SIZE=20 显式传（D16，抹平契约缺省 10，N1）。**对齐 AC-F1-1**。建议未来 contracts listNotificationQuerySchema.pageSize default 调整为 20 或前端常量化到 shared lib（与 ReportPage PAGE_SIZE=20 一致）。**Tech-Spec §10 未列此项**（纯常量化，R13 S-2 不须同步 Spec §10 但须 Review 报告记录） | ⚠️ **合理偏离（纯常量化）**——S-5。功能不弱化（pageSize=20 显式传） |
| 6 | **ReportPage appliedFilters 分页保持筛选可考虑 URL 持久化**（Reviewer 发现） | `ReportPage.tsx` appliedFilters state，翻页时保持筛选条件（R13 S-3）。**对齐 AC-F7-5**。但 appliedFilters 仅在内存 state，刷新页面丢失筛选条件。建议未来用 URL query 持久化（如 ?group_by=operator_id&page=2）。**Tech-Spec §10 未列此项**（advisory UX，R13 S-2 不须同步 Spec §10 但须 Review 报告记录） | ⚠️ **合理偏离（advisory UX）**——S-6。功能不弱化（分页保持筛选在内存态生效） |
| 7 | **vitest.config.ts testTimeout 20000 全局生效**（Reviewer 发现） | `vitest.config.ts:31-33` testTimeout: 20000（默认 5000ms 对 4001 字符 user.type 超时）。注释明示"仅放宽超时上限，不掩盖断言失败"。但全局生效，对其他快速测试也放宽超时。建议未来用 it.timeout 或 per-file 配置仅对超长用例放宽。**Tech-Spec §10 未列此项**（advisory 测试配置） | ⚠️ **合理偏离（advisory 测试配置）**——S-7。功能不弱化（仅放宽超时上限，断言失败仍报错） |
| 8 | **NotificationForm UUID_RE 与 ReportFilter UUID_RE 重复定义**（Reviewer 发现） | `NotificationForm.tsx` + `ReportFilter.tsx` 均定义 UUID_RE 正则做客户端 advisory 校验。两处定义重复，建议未来提取到 apps/web/src/lib/uuid.ts 或 contracts shared lib 复用。**Tech-Spec §10 未列此项**（advisory 代码复用） | ⚠️ **合理偏离（advisory 代码复用）**——S-8。功能不弱化（两处 UUID_RE 校验逻辑一致） |

### advisory 偏离核对小结

- **已反向同步 Spec §10**：0 项（R15 D8/D9/D12/D13/D14/D17 等 [约束] 决策已同步 Spec §10，advisory 偏离均为纯 UI 文案/常量/UX/测试配置类）
- **纯 UI 文案/常量/UX/测试配置偏离（R13 S-2 不须同步 Spec §10 但须 Review 报告记录）**：8 项（#1 option text 改英文、#2 动态列空值兜底、#3 UUID_RE advisory 校验、#4 fixture 一致性、#5 PAGE_SIZE 常量化、#6 URL 持久化、#7 testTimeout 全局、#8 UUID_RE 重复定义）⚠️——均为 suggestion，不阻断合入（功能不弱化 + AC 对齐）。

## §5 [约束] 偏离核对

**0 处 [约束] 偏离需记 blocker**。逐条核对 D1~D21 [约束] 项落地：

- D1 前端分层复用 R12/R14 + 新增通知/报表两域 ✅（apps/web/src 分层 api/pages/components/auth/lib 沿用，新增模块依赖方向单向）
- D2 ARCH-003 持续合规 ✅（见 §7）
- D3 类型 z.infer 派生 ✅（全部 import type from @admin/contracts）
- D4 自由文本表单须 safeParse ✅（NotificationForm createNotificationInputSchema.safeParse + updateNotificationInputSchema.safeParse，AC-ARCH-3 完全对齐）
- D5 类型派生操作不强制 safeParse ✅（NotificationListPage send/markRead/delete + ReportFilter group_by checkbox/entity_type/action select，AC-ARCH-4 完全对齐，impl 显式标注理由）
- D6 API client 复用 R12 ✅（新增 api/notifications.ts、api/reports.ts 仅调 request<T>，不重复封装 fetch）
- D7 通知 4 versioned 端点 + If-Match + 409 重试 ✅（api/notifications.ts update/send/markRead/delete 全部 versioned=true + expectedVersion，AC-F3-1/F4-1/F5-1/F6-1）
- D8 client.ts query 类型扩展支持 string[] ✅（repeated key，对齐 server.ts m.query.getAll，后向兼容 number 既有断言）
- D9 errorMapping 扩展 SPECIFIC_MESSAGES ✅（通知/报表码中文 + SSOT 派生保留 + R14 S-11 同步注释闭合，AC-F9-1/2/3）
- D10 报表 PII 无（纯计数非 PII）✅（contracts 明示 report 聚合维度均为非 PII 字段，仅返回计数）
- D11 ReportTable 动态列渲染 ✅（据 result.group_by 遍历渲染列头 + count 固定列，AC-F7-8）
- D12 报表"应用筛选"按钮 ✅（R14 S-9 教训闭合，不每键入触发请求，AC-F7-2/F7-3）
- D13 group_by 不预填默认维度 ✅（Q8 决策②，客户端 advisory 校验非空 + 服务端兜底，AC-F7-6）
- D14 datetime-local + ISO 归一 ✅（normalizeDatetime new Date(...).toISOString()，AC-F7-2）
- D15 recipient_id 自由文本 UUID + 存在性延后至 send ✅（Q4 决策①，AC-F2-5/F2-6/F4-4/F4-5）
- D16 pageSize 显式传 20 ✅（NotificationListPage/ReportPage PAGE_SIZE=20 显式传，抹平契约缺省 10，N1）
- D17 侧边栏 6 入口 + 路由守卫 ✅（Sidebar 6 入口 + App.tsx /notifications /reports RouteGuard，AC-F8-1/F8-2/F8-3）
- D18 通知详情页 out-of-scope ✅（无 /notifications/:id 路由，对齐 R14 Q9 决策②不消费 GET /:id 精神）
- D19 报表图表可视化 out-of-scope ✅（无图表库，零新依赖）
- D20 api 命名对齐 Spec §4.2 ✅（R14 S-8 教训闭合，api/notifications.ts + api/reports.ts 函数命名对齐 Spec 声明）
- D21 aria-label 域特定 ✅（R14 S-10 教训闭合，NotificationForm aria-label="通知标题"/"通知内容"/"收件人 ID"，ReportFilter aria-label={dim}（英文）+ span"按X分组"消歧 + select label 加"筛选"后缀消歧）

**[约束] 偏离小结**：0 blocker。D1~D21 全部 [约束] 项落地，AC-ARCH-3/ARCH-4 完全对齐（impl 显式标注类型派生操作不调 safeParse + 理由）。R14 S-8~S-11 教训在本轮全部注意并闭合（S-8 api 命名 / S-9 应用筛选按钮 / S-10 aria-label 域特定 / S-11 同步注释）。

## §6 测试覆盖核对（AI-006 + R13 S-3，含 impl-writer setup 改动核对）

### §9 测试清单 7 文件预估 vs 实际 7 文件 + ①类显式影响调整

| # | Spec §9.3 文件 | 实际存在 | 覆盖 AC（Spec 声明） | 实际测试数 |
|---|---|---|---|---|
| 1 | `apps/web/test/api-notifications.test.ts`（T1，③类新增） | ✅ | AC-F1-1/F1-3、AC-F2-1、AC-F3-1/F3-3/F3-4、AC-F4-1/F4-3、AC-F5-1/F5-4、AC-F6-1/F6-3、AC-F10-1/F10-2、AC-ARCH-2 | ✅ |
| 2 | `apps/web/test/api-reports.test.ts`（T2，③类新增） | ✅ | AC-F7-1~F7-9、AC-F9-2、AC-F10-1/F10-2、AC-ARCH-2 | ✅ |
| 3 | `apps/web/test/notification-list-page.test.tsx`（T3，③类新增） | ✅ | AC-F1-1~F1-7、AC-F3-2、AC-F4-1~F4-5、AC-F5-1~F5-3、AC-F6-1~F6-4、AC-ARCH-4、AC-S1-2 | ✅ |
| 4 | `apps/web/test/notification-form.test.tsx`（T4，③类新增） | ✅ | AC-F2-1~F2-6、AC-F3-1~F3-5、AC-ARCH-3、AC-S1-1 | ✅ |
| 5 | `apps/web/test/report-page.test.tsx`（T5，③类新增） | ✅ | AC-F7-1~F7-9、AC-F9-2、AC-ARCH-3、AC-S1-1/S1-2 | ✅ |
| 6 | `apps/web/test/navigation-extend.test.tsx`（T6，**①类显式影响新增独立文件**） | ✅ | AC-F8-1~F8-3、AC-ARCH-1、AC-F10-3 | ✅ |
| 7 | `apps/web/test/error-mapping-extend-2.test.ts`（T9，**①类显式影响新增独立文件**） | ✅ | AC-F9-1~F9-3、AC-S1-1（advisory） | ✅ |

**test-writer 偏离 Spec §9.3 的 ①类显式影响处理**：
- **①类显式影响 1**：R14 既有 `navigation.test.tsx` line 69 断言"侧边栏渲染 4 入口"，R15 D17 扩展 Sidebar 为 6 入口后须调整。test-writer 选择**新增独立文件 navigation-extend.test.tsx**（断言 6 入口 + /notifications /reports 路由守卫）+ impl-writer 调整 R14 既有 navigation.test.tsx 的 4 入口断言为 6 入口（it 标题 4→6 + 追加 2 条 Link 断言，①类显式影响注释标注完整）。**理由合理**：AI-002 禁止改既有测试断言，test-writer 选择新增独立文件覆盖 R15 目标态 + 仅对 ①类显式影响（4→6 入口）调整 R14 既有断言 matcher（注释标注完整）。
- **①类显式影响 2**：R14 既有 `error-mapping-extend.test.ts` 断言 ROLE/DEPT/AUDIT/INVALID_CREDENTIALS/VERSION_CONFLICT 码（不断言 NOTIFICATION/REPORT 码），R15 扩展 SPECIFIC_MESSAGES 后 R14 既有断言**预估不失效**。test-writer 选择**新增独立文件 error-mapping-extend-2.test.ts**（断言通知/报表码中文 + TRANSFER/ROLE_INHERITANCE FALLBACK + R12/R14 既有码不破坏）+ 不修改 R14 既有 error-mapping-extend.test.ts（预估不失效，impl-writer double-check 核验）。**理由合理**：AI-002 禁止改既有测试断言，R14 既有断言不断言 NOTIFICATION/REPORT 码故不失效，新增独立文件覆盖 R15 扩展码。

**判定**：test-writer ①类显式影响处理合理（AI-002 边界 + 新增独立文件 + ①类显式影响注释标注完整），③类新增文件数对齐 Spec §9.3 预估，无偏离。

### 54 AC 全覆盖核对（AC↔测试覆盖矩阵）

- F1-1~F1-7 → T3 notification-list-page.test.tsx + T1 ✅（F1-4 组合场景 R13 S-3、F1-7 status 文案+按钮动态显示）
- F2-1~F2-6 → T4 notification-form.test.tsx + T1 ✅（F2-2~F2-5 自由文本 safeParse、F2-6 延后校验跨 T1）
- F3-1~F3-5 → T4 + T1 ✅（F3-2/F3-3/F3-4 跨 T1+T4）
- F4-1~F4-5 → T3 + T1 ✅（F4-3/F4-4/F4-5 跨 T1+T3）
- F5-1~F5-4 → T3 + T1 ✅（F5-4 跨 T1+T3）
- F6-1~F6-4 → T3 + T1 ✅（F6-3/F6-4 跨 T1+T3）
- F7-1~F7-9 → T5 report-page.test.tsx + T2 ✅（F7-5 组合场景 R13 S-3、F7-6/F7-7 跨 T2+T9、F7-1/F7-4 SSOT 派生）
- F8-1~F8-3 → T6 navigation-extend.test.tsx + R14 navigation.test.tsx ①类显式影响调整 ✅
- F9-1~F9-3 → T9 error-mapping-extend-2.test.ts + T1 ✅（F9-3 401/网络错误沿用 R12/R14）
- F10-1/F10-2 → T1/T2 + T6 ✅
- F10-3 → T6 navigation-extend.test.tsx（工程核验）✅
- ARCH-1 → T6 + lint:rules 探针 + Reviewer 逐文件 ✅
- ARCH-2 → T1/T2 + Reviewer ✅
- ARCH-3 → T4/T5 ✅
- S1-1 → T4/T5 ✅
- S1-2 → T3/T5 ✅

**54 AC 全覆盖 ✅**，无未覆盖 AC（test-writer AC 覆盖矩阵自检 R13 S-3 闭合）。

### impl-writer 测试 setup 改动核对（R15 关键）

R15 impl-writer 改了测试 setup 须严格核对。`git diff HEAD --stat -- apps/web/test/` + vitest.config.ts 显示 4 处改动：

#### 改动 1：notification-form.test.tsx VALID_UUID fixture 非hex→有效hex（①类 setup 调整）

**改动位置**：`apps/web/test/notification-form.test.tsx:93-96`
```ts
// [R15 impl-writer 改] 原 fixture '...0000u1' 含非 hex 字符 'u'，被 createNotificationInputSchema
//   z.string().uuid() 拒绝（safeParse 失败 → createNotification 永不调用）。
//   改为有效 hex UUID '...000001'（①类 setup 调整，对齐 contracts z.string().uuid() 严格校验）。
const VALID_UUID = '00000000-0000-4000-8000-000000000001';
```

**判定**：✅ **合理 setup 调整**
- **根因**：原 fixture `...0000u1` 含非 hex 字符 'u'，被 createNotificationInputSchema z.string().uuid() 严格校验拒绝（safeParse 失败 → createNotification 永不调用 → 创建成功用例断言失败）。
- **改动性质**：setup fixture 调整（非断言弱化），改为有效 hex UUID `...000001` 对齐 contracts z.string().uuid() 严格校验。
- **AI-002 边界判定**：setup 调整属"仅可改 setup/import 路径并注明理由"边界，根因是 contracts z.string().uuid() 严格校验（非 impl-writer 主观弱化断言），注释标注完整（受影响文件 + 改动性质 + 理由）。**pass**。

#### 改动 2：report-page.test.tsx checkGroupByDim helper 改用英文 dim regex + operator_id UUID 同步（①类 setup 调整）

**改动位置**：`apps/web/test/report-page.test.tsx:80-85` + L173-180
```ts
/** 勾选一个 group_by 维度 checkbox（按维度值 aria-label 定位）。
 * [R15 impl-writer 改] checkbox 改用 aria-label={dim}（英文维度值），避免 getByLabelText(/实体类型/)
 *   同时匹配 checkbox + select；helper 改用 dim（英文）做 regex（①类 setup 调整）。 */
async function checkGroupByDim(user: ReturnType<typeof userEvent.setup>, dim: string) {
  await user.click(screen.getByRole('checkbox', { name: new RegExp(dim) }));
}
```
```ts
// [R15 impl-writer 改] 原 fixture '...0000u1' 含非 hex 字符 'u'，被 ReportFilter advisory UUID_RE 拦截（不发请求）。
//   改为有效 hex UUID '...000001'（①类 setup 调整，对齐 z.string().uuid() 严格校验）。
await user.type(screen.getByLabelText(/操作者 ID|operator id/i), '00000000-0000-4000-8000-000000000001');
```

**判定**：✅ **合理 setup 调整**
- **根因 1**：ReportFilter checkbox aria-label={dim}（英文维度值，如 'entity_type'）+ select label="实体类型"（中文），若 helper 用 `getByLabelText(/实体类型/)` 会同时匹配 checkbox（aria-label='entity_type' 含"实体类型"语义）+ select（label="实体类型"），歧义。改为 `getByRole('checkbox', { name: new RegExp(dim) })` 用英文 dim regex 精确定位 checkbox。
- **根因 2**：operator_id 输入值原 fixture `...0000u1` 含非 hex 'u'，被 ReportFilter advisory UUID_RE 拦截（不发请求 → 断言失败）。改为有效 hex UUID `...000001` 对齐 advisory UUID_RE 校验。
- **改动性质**：setup helper + fixture 调整（非断言弱化），改用英文 dim regex 消歧 + 有效 hex UUID 对齐 advisory 校验。
- **AI-002 边界判定**：setup 调整属"仅可改 setup/import 路径并注明理由"边界，根因是 getByLabelText 多匹配歧义 + advisory UUID_RE 严格校验（非 impl-writer 主观弱化断言），注释标注完整。**pass**。

#### 改动 3：navigation.test.tsx 4→6 入口断言调整（①类显式影响）

**改动位置**：`apps/web/test/navigation.test.tsx:69-93`
- L70-79：①类显式影响注释标注完整（受影响文件=navigation.test.tsx + 改动性质=断言 matcher 调整 + 理由=D17 扩展 4→6 入口 + Reviewer 确认）。
- L80：it 标题"侧边栏渲染 4 入口"→"侧边栏渲染 6 入口（用户/角色/部门/审计/通知/报表）"。
- L88-90：追加 2 条 Link 断言（通知/报表）。

**判定**：✅ **合理 ①类显式影响调整**
- **根因**：D17 扩展 Sidebar 为 6 入口（新增通知/报表），原 4 入口断言虽不会失败（4 个 Link 仍存在），但断言措辞"4 入口"与扩展后实际 6 入口态不符，且未覆盖新增的 /notifications /reports 入口（断言覆盖不完整）。
- **改动性质**：断言 matcher 调整（it 标题 4→6 + 追加 2 条 Link 断言），非新增测试用例，非断言弱化（从 4 入口扩展为 6 入口，覆盖增强）。
- **AI-002 边界判定**：matcher 文本改动 + 追加断言属"断言 matcher 调整"边界，根因是 D17 扩展 4→6 入口（非 impl-writer 主观弱化断言），语义增强非弱化（覆盖从 4 入口扩展为 6 入口），①类显式影响注释标注完整。**pass**。详见 §8.1。

#### 改动 4：vitest.config.ts testTimeout 5000→20000（①类 setup 调整）

**改动位置**：`vitest.config.ts:31-33`
```ts
// [R15 impl-writer 改] user-event 逐字符输入 4001 字符（content > 4000 safeParse 测试）超过默认 5000ms，
//   提升 testTimeout 至 20000ms（仅放宽超时上限，不掩盖断言失败）。
testTimeout: 20000,
```

**判定**：✅ **合理 setup 调整**
- **根因**：`notification-form.test.tsx` content > 4000 safeParse 测试用 `user.type(screen.getByLabelText(/通知内容/i), 'a'.repeat(4001))`，user-event 逐字符输入 4001 字符超过默认 5000ms 超时。
- **改动性质**：testTimeout 配置调整（非断言弱化），提升至 20000ms 适配长字符串输入。注释明示"仅放宽超时上限，不掩盖断言失败"。
- **AI-002 边界判定**：配置调整属"仅可改 setup/import 路径并注明理由"边界，根因是 user-event 逐字符输入性能限制（非 impl-writer 主观弱化断言），注释标注完整。**pass**。
- **advisory**：testTimeout 全局生效，对其他快速测试也放宽超时。建议未来用 it.timeout 或 per-file 配置仅对超长用例放宽（S-7）。

### D8 client.ts query 类型扩展是否破坏 R12 既有 api-client.test.ts

**判定：未破坏**。
- R12 既有 `api-client.test.ts:215-217` RequestOptions 断言 `query: { page: 1 }`（number 类型），D8 扩展后 number 仍支持（query 类型 `Record<string, string | number | string[] | undefined>`，number 仍合法），既有断言不失效。
- 编排者实跑 vitest 全量 1089/1089（web 256 全绿），R12 api-client.test.ts 全绿 ✅。

### D9 errorMapping 扩展是否破坏 R14 既有 error-mapping-extend.test.ts

**判定：未破坏**。
- R14 既有 `error-mapping-extend.test.ts` 断言 ROLE/DEPT/AUDIT/INVALID_CREDENTIALS/VERSION_CONFLICT 码（不断言 NOTIFICATION/REPORT 码 → FALLBACK），R15 扩展 SPECIFIC_MESSAGES 后 R14 既有断言不失效（ROLE/DEPT/AUDIT/INVALID_CREDENTIALS/VERSION_CONFLICT 码映射不变）。
- 编排者实跑 vitest 全量 1089/1089（web 256 全绿），R14 error-mapping-extend.test.ts 全绿 ✅。

### AI-006 是否生效

✅ **生效**。Tech-Spec §9 三类标注完整（①类 1~2 显式边缘 + 0 隐式 / ②类 0 / ③类 5 文件预估 + 2 ①类显式影响新文件），test-writer 实际新增 7 文件（5 ③类 + 2 ①类显式影响新文件），54 AC 全覆盖，①类显式影响识别 + 反向核实闭合。

## §7 ARCH-003 专项（R15 持续合规验证）

### 7.1 逐文件核对 apps/web/src 新增模块 import（7 文件）

| 文件 | import 来源 | ARCH-003 合规 |
|---|---|---|
| api/notifications.ts | @admin/contracts (type), ./client.js | ✅ |
| api/reports.ts | @admin/contracts (type), ./client.js | ✅ |
| pages/NotificationListPage.tsx | react, @admin/contracts (notificationStatusSchema + type), ../api/notifications.js, ../api/client.js, ../components/ErrorBanner.js, ../components/NotificationForm.js, ../lib/errorMapping.js | ✅ |
| pages/ReportPage.tsx | react, @admin/contracts (type), ../api/reports.js, ../api/client.js, ../components/ErrorBanner.js, ../components/ReportFilter.js, ../components/ReportTable.js, ../lib/errorMapping.js | ✅ |
| components/NotificationForm.tsx | react (useState + FormEvent type), @admin/contracts (createNotificationInputSchema + updateNotificationInputSchema + type), ../api/notifications.js, ../api/client.js, ../lib/errorMapping.js | ✅ |
| components/ReportFilter.tsx | react (useState + FormEvent type), @admin/contracts (reportGroupByDimSchema + auditLogEntityTypeSchema + auditLogActionSchema + type), ../lib/errorMapping.js | ✅ |
| components/ReportTable.tsx | react, @admin/contracts (type) | ✅ |

**结论**：7 文件全部仅 import `@admin/contracts` + 第三方（react/react-router-dom）+ apps/web 内部相对模块（`./`、`../`）。**0 处 `apps/api/src/**` 或 `@admin/api` 实际引用**。

### 7.2 apps/api/src 或 @admin/api 引用 grep 确认

R15 新增文件（api/notifications.ts、api/reports.ts、pages/NotificationListPage.tsx、pages/ReportPage.tsx、components/NotificationForm.tsx、components/ReportFilter.tsx、components/ReportTable.tsx）0 命中（注释措辞略不同，无 apps/api/src 字样更无实际 import）。✅

### 7.3 lint:rules ARCH-003 + CODE 扫描器是否通过（R13 S-4 已覆盖前端）

- R12 §8 已落地 ARCH-003 分支（check-rules.mjs walkWeb 收集 .ts + .tsx，ARCH003_FORBIDDEN_RE 三条禁止规则 `^@admin/api\b` / `api/src/` / `^apps/api\b`）。
- R13 S-4 已将 walkWeb 提升为顶层函数 + allTs 含 apps/web/src + apps/web/test，使 CODE-001/002/003/004/AI-005 扫描器自动覆盖前端。
- R15 新增 7 前端文件位于 `apps/web/src/`，自动受 ARCH-003 分支 + CODE 扫描器覆盖，lint:rules exit 0 ✅。
- **Reviewer 逐文件核对**（7.1）+ grep 确认（7.2）+ lint:rules exit 0 三重验证 ARCH-003 持续合规。

### 7.4 layering.md 校验方式 + META-003/META-004 闭合

- `layering.md` ARCH-003 校验方式已机器化（含 `check-rules.mjs ARCH-003 分支` + `apps/web/src/**/*.{ts,tsx}` 措辞）✅。
- META-003（声明即实现）：layering.md 校验方式含"check-rules.mjs ARCH-003 分支"措辞 ↔ check-rules.mjs markEnforcement('ARCH-003') ✅。
- META-004（实现即声明）：check-rules.mjs markEnforcement('ARCH-003') ↔ layering.md `## ARCH-003` 块存在 ✅。
- lint:rules 输出"双向绑定：META-003(声明即实现) + META-004(实现即声明) 已校验" ✅。
- R15 无规则文件改动，双向绑定持续闭合。

### 7.5 ARCH-003 专项结论

**ARCH-003 在 R15 新增模块下持续合规**：
- 逐文件核对 0 违规 ✅
- grep 确认 0 实际 import 命中 ✅
- lint:rules ARCH-003 分支 + R13 S-4 CODE 扫描器 exit 0 ✅
- META-003/META-004 双向绑定持续闭合 ✅
- layering.md 校验方式机器化描述持续有效 ✅

R12 最大未验证缺口（ARCH-003 机器化 enforcement）在 R15 前端全域覆盖收尾下持续有效，新增 7 文件自动受约束，无须新增校验逻辑。

## §8 ①类显式影响专项（R15 关键）

### 8.1 R14 navigation.test.tsx 4→6 入口断言调整判定

**改动内容**（git diff 确认）：
- 原 R14 断言：`it('侧边栏渲染 4 入口（用户/角色/部门/审计）+ 登出按钮（AC-F8-1，D16）')` 仅断言 4 入口 Link。
- 新 R15 断言：`it('侧边栏渲染 6 入口（用户/角色/部门/审计/通知/报表）+ 登出按钮（AC-F8-1，D16+R15 D17 扩展 4→6）')` + 追加 2 条 Link 断言（通知/报表）。

**判定：合理（AI-002 边界 pass）**。

**判定依据**：
1. **根因是 D17 扩展 Sidebar 6 入口**：R15 D17 扩展 Sidebar 为 6 入口（新增通知/报表），原 4 入口断言虽不会失败（4 个 Link 仍存在），但断言措辞"4 入口"与扩展后实际 6 入口态不符，且未覆盖新增的 /notifications /reports 入口（断言覆盖不完整）。
2. **语义增强非弱化**：从 4 入口扩展为 6 入口，追加 2 条 Link 断言覆盖通知/报表入口，断言覆盖增强而非弱化。
3. **①类显式影响注释标注完整**：navigation.test.tsx L70-79 注释明示"①类显式影响（AI-002 边界，对齐 R14 error-mapping.test.ts ROLE_NOT_FOUND 调整范例）：原 R14 断言... R15 D17 扩展 Sidebar 为 6 入口... 改动性质：断言 matcher 调整（it 标题 4→6 + 追加 2 条 Link 断言覆盖通知/报表入口），非新增测试用例。理由：D17 扩展使 Sidebar 入口数 4→6，原 4 入口断言需同步升级为 6 入口以保持断言与实现一致。Reviewer 确认：此为 test-writer 在 navigation-extend.test.tsx §7-15 已识别并标注的 ①类显式影响，impl-writer 据此落地（对齐 R14 范例，AI-002 已显式列出：受影响文件=navigation.test.tsx + 改动性质=断言 matcher 调整 + 理由=D17 扩展 4→6 入口）"——①类显式影响注释标注完整。
4. **AI-002 边界判定**：matcher 文本改动（it 标题 4→6 + 追加 2 条 Link 断言）属"断言 matcher 改动"边界，根因是 D17 扩展使 4 入口断言覆盖不完整（非 impl-writer 主观弱化断言），语义增强非弱化（覆盖从 4 入口扩展为 6 入口），①类显式影响注释标注完整 → pass。
5. **test-writer 反向核实**：navigation-extend.test.tsx L7-15 注释明示"①类显式影响：R14 既有 navigation.test.tsx line 69 断言'侧边栏渲染 4 入口'，R15 D17 扩展 Sidebar 为 6 入口后，该 4 入口断言失效（4→6）。本 test-writer 阶段不修改 R14 navigation.test.tsx（AI-002 禁止改既有测试断言）。impl-writer 在扩展 Sidebar.tsx 时须同步调整 R14 navigation.test.tsx 的 4 入口断言为 6 入口"——test-writer 反向核实闭合。

**对照 Tech-Spec §9.1 ①类显式影响预估**：Spec §9.1 预估"①类显式影响 0~2 文件（边缘）：navigation.test.tsx + error-mapping-extend.test.ts"。实际 ①类显式影响 1 文件调整（navigation.test.tsx 4→6 入口）；error-mapping-extend.test.ts 预估不失效（R14 既有断言不断言 NOTIFICATION/REPORT 码，R15 扩展后不失效，编排者实跑 1089/1089 全绿核验）。Spec 预估准确。

### 8.2 R14 error-mapping-extend.test.ts 预估不失效核验

**判定：未失效**。
- R14 既有 `error-mapping-extend.test.ts` 断言 ROLE/DEPT/AUDIT/INVALID_CREDENTIALS/VERSION_CONFLICT 码（不断言 NOTIFICATION/REPORT 码 → FALLBACK）。
- R15 D9 扩展 SPECIFIC_MESSAGES 新增通知/报表码中文提示，但 R14 既有断言的 ROLE/DEPT/AUDIT/INVALID_CREDENTIALS/VERSION_CONFLICT 码映射不变，R14 既有断言不失效。
- 编排者实跑 vitest 全量 1089/1089（web 256 全绿），R14 error-mapping-extend.test.ts 全绿 ✅。
- test-writer 在 error-mapping-extend-2.test.ts L5-13 注释明示"①类显式影响：R14 既有 error-mapping-extend.test.ts 断言 ROLE/DEPT/AUDIT/INVALID_CREDENTIALS/VERSION_CONFLICT 码（line 37-91），不断言 NOTIFICATION/REPORT 码。基于 grep 核验：R14 既有断言中无 NOTIFICATION_*/REPORT_* → FALLBACK 断言，故 R15 扩展 SPECIFIC_MESSAGES 后，R14 既有 error-mapping-extend.test.ts 预估不失效"——test-writer 反向核实闭合。

### 8.3 R12 api-client.test.ts D8 后向兼容核验

**判定：未破坏**。
- R12 既有 `api-client.test.ts:215-217` RequestOptions 断言 `query: { page: 1 }`（number 类型），D8 扩展后 query 类型 `Record<string, string | number | string[] | undefined>`，number 仍合法，既有断言不失效。
- 编排者实跑 vitest 全量 1089/1089（web 256 全绿），R12 api-client.test.ts 全绿 ✅。

### 8.4 AI-002 边界：断言 matcher 改动 vs 断言语义弱化的区分（R15 固化）

**判定标准**（R14 固化 + R15 setup 调整扩展）：
- **断言 matcher 改动（pass 边界）**：根因是 Spec/契约扩展使原断言失效（如枚举扩展、SPECIFIC_MESSAGES 扩展、Sidebar 入口扩展），matcher 文本改动以对齐扩展后语义，SSOT 派生机制保留，语义不弱化（从通用 → 精准 或从覆盖不完整 → 覆盖完整），①类显式影响注释标注完整。
- **setup 调整（pass 边界）**：根因是 contracts 严格校验（z.string().uuid()）/ getByLabelText 多匹配歧义 / user-event 性能限制 / D17 扩展，setup fixture/helper/配置调整对齐严格校验或消歧，非断言弱化，注释标注完整。
- **断言语义弱化（blocker 边界）**：impl-writer 主观弱化断言以绕过实现缺陷（如 toEqual → toContain 降级匹配范围、toBe → toBeNull 掩盖返回值变化、删除关键断言），无 Spec/契约扩展根因，无 ①类显式影响标注。

**R15 4 处测试改动**：
1. navigation.test.tsx 4→6 入口：属"断言 matcher 改动（pass 边界）"——根因 D17 扩展 4→6 入口，matcher 文本 + 追加断言，语义增强非弱化，①类显式影响注释标注完整。**pass**。
2. notification-form.test.tsx VALID_UUID fixture：属"setup 调整（pass 边界）"——根因 contracts z.string().uuid() 严格校验，fixture 非hex→有效hex，非断言弱化，注释标注完整。**pass**。
3. report-page.test.tsx checkGroupByDim helper + operator_id UUID：属"setup 调整（pass 边界）"——根因 getByLabelText 多匹配歧义 + advisory UUID_RE 严格校验，helper 改英文 regex 消歧 + fixture 有效hex，非断言弱化，注释标注完整。**pass**。
4. vitest.config.ts testTimeout 5000→20000：属"setup 调整（pass 边界）"——根因 user-event 逐字符输入 4001 字符超时，配置调整不掩盖断言失败，注释标注完整。**pass**。

## §9 多[约束]组合副作用核对（Tech-Spec §10 末 8 条）

| # | 组合 | Spec §10 预判 | 实现核查 | 结论 |
|---|---|---|---|---|
| 1 | 通知 4 versioned 端点 (D7) + 409 重试复用 R12 D9 + 状态守卫 NOTIFICATION_INVALID_TRANSITION | 4 versioned 端点（update/send/markRead/delete）全部 If-Match + 409 VERSION_CONFLICT 自动重试；INVALID_TRANSITION（409 但非 VERSION_CONFLICT）不重试，抛 ApiError 由调用方处理；DELETE 重试幂等（重试发生在同次冲突未删成功的场景，409 表示未删除）；重试成功后须刷新列表取最新 version | `api/notifications.ts` 4 端点全部 versioned=true + expectedVersion；client.ts D9 重试仅匹配 `code === 'VERSION_CONFLICT'`，INVALID_TRANSITION 不重试；`NotificationListPage.tsx` 操作成功 → refresh()；NOTIFICATION_NOT_FOUND → refresh() 移除已不存在行；api/notifications.ts 注释明示"409 INVALID_TRANSITION 不重试（非 VERSION_CONFLICT）" | ✅ 正确 |
| 2 | group_by 数组 query (D8) + URLSearchParams repeated key + server.ts m.query.getAll | api/reports.ts queryOperations 传 group_by: ReportGroupByDim[]，client.ts buildUrl 须拼接为 repeated key `?group_by=A&group_by=B`（对齐 server.ts L341 m.query.getAll('group_by')）；impl 须保证 D8 扩展 query 类型支持 string[] 不破坏既有 number/string query | `client.ts` RequestOptions.query 类型扩展 `Record<string, string \| number \| string[] \| undefined>`；buildUrl 对 Array.isArray 分支逐元素 append（repeated key）；R12 既有 api-client.test.ts `query: { page: 1 }`（number）D8 扩展后不失效；api/reports.ts queryOperations 传 group_by 数组 | ✅ 正确 |
| 3 | errorMapping 扩展 (D9) + SSOT 派生 (R12 D11) + R14 S-11 同步注释 + R14 既有测试不失效 | R15 扩展 SPECIFIC_MESSAGES 新增通知/报表码中文提示，但映射表键仍从 [...errorCodeSchema.options] SSOT 派生；errorCodeSchema 枚举未扩展（通知/报表码本就在枚举内），SSOT 派生断言不失效；扩展时同步更新"未映射码"注释（R14 S-11，注释须反映扩展后实际未映射域如 TRANSFER/ROLE_INHERITANCE）；R14 既有 error-mapping-extend.test.ts 若断言"NOTIFICATION_NOT_FOUND → FALLBACK"会失效，impl-writer 须调整（预估不失效，须 double-check） | `errorMapping.ts:63-68` ERROR_MESSAGES 键从 [...errorCodeSchema.options] SSOT 派生（R12 D11 沿用）；L18-19/L55/L72 三处注释同步反映扩展后实际未映射域（TRANSFER/ROLE_INHERITANCE）；R14 既有 error-mapping-extend.test.ts 不断言 NOTIFICATION/REPORT 码 → 不失效（编排者实跑 1089/1089 全绿核验）；error-mapping-extend-2.test.ts L82-103 断言 R12/R14 既有码不破坏 + TRANSFER/ROLE_INHERITANCE FALLBACK | ✅ 正确 |
| 4 | 状态机展示 (Q3/Q11) + 按 status 隐藏按钮 + 状态守卫拒绝统一码 NOTIFICATION_INVALID_TRANSITION | 前端按 status 动态显示操作按钮（draft→编辑/发送/删除、sent→标记已读、read→无），隐藏不可用（Q3 决策①）；status 文案中文化（Q11 决策②）；状态守卫拒绝统一抛 NOTIFICATION_INVALID_TRANSITION（B6 单码覆盖所有状态非法，N2/N3），前端 errorMapping 映射"通知状态不允许此操作"；前端隐藏按钮 + 后端兜底（双保险，前端绕过直接调 API 仍被后端拒绝） | `NotificationListPage.tsx` 按 status 条件渲染按钮（draft→编辑/发送/删除、sent→标记已读、read→无）；STATUS_LABEL={draft:'草稿',sent:'已发送',read:'已读'}；errorMapping NOTIFICATION_INVALID_TRANSITION='通知状态不允许此操作'；前端隐藏 + 后端兜底双保险 | ✅ 正确 |
| 5 | group_by 不预填 (D13) + 客户端 advisory 校验 + 服务端兜底 REPORT_GROUP_BY_REQUIRED (N5) | Q8 决策②不预填默认维度；客户端 advisory 校验 group_by 至少 1 维显示"请至少选择一个分组维度"不发请求；服务端兜底 REPORT_GROUP_BY_REQUIRED（若客户端未拦截直接请求）；AC 同时测客户端拦截 + 服务端码映射 | `ReportFilter.tsx` group_by 默认不勾选；客户端 advisory 校验 group_by 至少 1 维显示"请至少选择一个分组维度"不发请求；errorMapping REPORT_GROUP_BY_REQUIRED='请至少选择一个分组维度'；`report-page.test.tsx` group_by 空拦截用例 + `api-reports.test.ts` 服务端码映射 | ✅ 正确 |
| 6 | 动态列 (D11) + z.record (N6) + DIM_LABEL 中文化映射 + group_by 原样回显 | ReportTable 据 `result.group_by`（原样回显声明的维度）渲染列头；每行 item 据 dim key 取值（`item[dim]`，z.record 类型保证 string|number）；维度列中文名映射（DIM_LABEL）；count 固定列；group_by 变化时列头动态更新；impl 须保证运行时遍历 result.group_by 渲染（TS 不强制具体键名） | `ReportTable.tsx` 据 `result.group_by` 遍历渲染列头（DIM_LABEL 中文化映射）+ count 固定列；`item[dim] !== undefined ? String(item[dim]) : ''` 兜底空字符串；ReportAggItem 为 `Record<string, string\|number> & {count: number}`，运行时遍历 result.group_by 渲染 | ✅ 正确 |
| 7 | 混合表单 safeParse (D4) + 类型派生操作 (D5) 在 NotificationForm + ReportFilter | NotificationForm create 模式含自由文本（title/content/recipient_id，须 safeParse）；NotificationForm edit 模式含自由文本 partial（须 safeParse）；ReportFilter 含自由文本（operated_from/operated_to/operator_id，客户端字段 advisory 校验）+ 类型派生（group_by checkbox/entity_type/action select，safeParse 冗余）；impl 须对自由文本表单调 safeParse，类型派生操作值经 SSOT options 派生保证合法 | `NotificationForm.tsx` create 模式 createNotificationInputSchema.safeParse（整体校验覆盖 title/content/recipient_id）；edit 模式 updateNotificationInputSchema.safeParse（partial）；ReportFilter operated_from/operated_to/operator_id 客户端字段 advisory 校验；ReportFilter group_by checkbox（options 从 [...reportGroupByDimSchema.options] SSOT 派生）+ entity_type/action select（options 从 [...auditLogEntityTypeSchema.options]/[...auditLogActionSchema.options] SSOT 派生）；NotificationListPage send/markRead/delete 按钮（id/version 从列表派生，TS 类型保证，不调 safeParse） | ✅ 正确 |
| 8 | client.ts query 扩展 (D8) + 后向兼容 + R12 既有测试 | D8 扩展 query 类型支持 string[] 是通用增强，对齐 server.ts getAll 语义；impl 须保证：(1) buildUrl 对数组值多次 append（repeated key）；(2) 空数组跳过；(3) string/number/undefined 行为不变（后向兼容）；(4) R12 既有 api-client.test.ts RequestOptions 断言 `query: { page: 1 }`（number）不失效 | `client.ts` RequestOptions.query 类型扩展 `Record<string, string \| number \| string[] \| undefined>`；buildUrl 对 Array.isArray 分支逐元素 append（repeated key），空数组跳过，string/number/undefined 行为不变；R12 既有 api-client.test.ts:215-217 `query: { page: 1 }`（number）D8 扩展后不失效（编排者实跑 1089/1089 全绿核验） | ✅ 正确 |

**多约束组合小结**：8 条预判全部正确实现，无副作用 bug。组合 #1（4 versioned + 409 重试 + 状态守卫）是 R15 密度最高的多约束组合（4 端点 versioned 复用 R12 D9），实现均满足。组合 #2（group_by 数组 query + URLSearchParams）+ #8（client.ts query 扩展后向兼容）是 D8 query 类型扩展的关键正确性保证，实现均满足。组合 #3（errorMapping 扩展 + SSOT + R14 S-11 同步注释 + R14 既有测试不失效）的 ①类显式影响预估不失效经 §8.2 判定 pass。

## §10 结论与剩余改进项

### 总体结论

三件套全绿（tsc 0 错误 + check-rules.mjs exit 0 ARCH-003 + CODE 扫描器全过 + vitest 1089/1089 = web 256 + api 833），R15 前端全域覆盖收尾交付质量高：
- **AI-007 PRD 逐条核对**：54 条 AC 全对齐（49 功能 + 3 ARCH-003 + 2 R13 S-1），0 ⚠️ 偏离，0 ❌ 未实现。
- **ARCH-003 持续合规**（R15 验证点）：逐文件 0 违规 + grep 0 实际 import + lint:rules ARCH-003 + R13 S-4 CODE 扫描器 exit 0 + META-003/META-004 双向绑定持续闭合。R12 机器化 enforcement 在新增 7 文件下持续有效。
- **多约束组合副作用 8 条预判全部正确实现**（通知 4 versioned + 409 重试 + 状态守卫 / group_by 数组 query + URLSearchParams / errorMapping 扩展 + SSOT + R14 S-11 同步注释 / 状态机展示 + 隐藏按钮 / group_by 不预填 + advisory + 服务端兜底 / 动态列 + z.record / 混合表单 safeParse / client.ts query 扩展后向兼容）。
- **BA 核验 N1-N6 全部遵循 contracts SSOT**（pageSize 缺省分歧抹平 / partial 状态守卫 / 4 versioned 端点 / recipient 延后校验 / group_by 服务端兜底 / 动态维度键）。
- **R13 S-1 在状态机/聚合域下落地**（NotificationForm safeParse vs NotificationListPage/ReportFilter 类型派生，AC-ARCH-4 完全对齐）。
- **R13 S-3 AC↔测试覆盖矩阵自检闭合**（54 AC 全覆盖，test-writer 7 文件对齐 Spec §9.3 预估）。
- **①类显式影响判定 pass**（navigation.test.tsx 4→6 入口断言调整 + error-mapping-extend.test.ts 预估不失效 + api-client.test.ts D8 后向兼容核验）。
- **impl-writer 测试 setup 改动判定 pass**（4 处 setup/matcher 改动均合理：UUID hex 校准 + label 消歧 + testTimeout 提升 + navigation 4→6，无断言弱化，AI-002 边界 pass）。
- **R14 S-8~S-11 教训在本轮全部注意并闭合**（S-8 api 命名对齐 Spec / S-9 应用筛选按钮 / S-10 aria-label 域特定 / S-11 同步注释三处更新）。
- **D8 client.ts query 类型扩展后向兼容**（string[] 不破坏 number 既有断言，R12 api-client.test.ts 全绿）。
- **D9 errorMapping 扩展 + R14 S-11 同步注释闭合**（三处注释更新反映 TRANSFER/ROLE_INHERITANCE 域 FALLBACK）。

**相比 R14 多域扩展（68 AC + 8 suggestion + AC-ARCH-4 完全对齐）**，本轮 54 AC（49 功能 + 3 ARCH + 2 S-1）+ 8 suggestion，无 blocker，无 [约束] 偏离需记 blocker，AC-ARCH-3/ARCH-4 完全对齐。R15 前端全域覆盖收尾在 4 versioned 端点复用、状态机驱动域前端模式、聚合只读域 + 动态维度前端模式、D8 query 类型扩展后向兼容、D9 errorMapping 扩展 + R14 S-11 同步注释闭合、impl-writer 测试 setup 改动处理上均验证通过。R12 前端基础设施对"状态机驱动域（通知）"+"聚合只读域（报表）"两种新数据形态的复用性验证通过，前端全域覆盖（auth/user/role/dept/audit/notification/report 七域）完成。

### 剩余改进项（8 项 suggestion，不阻断合入）

#### S-1：NotificationListPage option text 改用英文枚举值（suggestion）

**位置**：`apps/web/src/pages/NotificationListPage.tsx`（status 筛选 select option text）
**问题**：status 筛选 select option text 改用英文枚举值（draft/sent/read）而非中文（草稿/已发送/已读），避免 getByLabelText(/草稿/) 等同时匹配 select option + 中文 status 单元格。对齐 AC-F1-3（status 筛选生效）+ AC-F1-7（status 文案中文化在单元格展示，非 select option）。R13 S-2 固化：纯 UI label 文案偏离不须同步 Spec §10 但须 Review 报告记录。
**建议**：本期接受（功能不弱化 + 筛选生效 + status 文案中文化在单元格）。未来可考虑用更精确的 select aria-label 消歧，恢复 option text 中文。

#### S-2：ReportTable 动态列空值兜底空字符串（suggestion）

**位置**：`apps/web/src/components/ReportTable.tsx`（`item[dim] !== undefined ? String(item[dim]) : ''`）
**问题**：动态列空值兜底空字符串，对齐 AC-F7-8（动态列渲染）。空字符串展示为空白，可读性略差。R13 S-2 固化：纯 UI 兜底展示偏离不须同步 Spec §10 但须 Review 报告记录。
**建议**：未来可考虑展示 '—' 提升可读性。非 blocker（功能不弱化 + 动态列渲染 + 空值兜底不报错）。

#### S-3：NotificationForm + ReportFilter UUID_RE 客户端 advisory 校验（suggestion）

**位置**：`apps/web/src/components/NotificationForm.tsx` + `apps/web/src/components/ReportFilter.tsx`（UUID_RE 正则）
**问题**：NotificationForm + ReportFilter 均定义 UUID_RE 正则做客户端 advisory 校验。对齐 AC-F2-5（recipient_id 非 uuid 拦截）+ AC-F7-3（operator_id 非 uuid advisory 拦截）。R13 S-2 固化：advisory 客户端校验偏离不须同步 Spec §10 但须 Review 报告记录。
**建议**：本期接受（双重校验保证 uuid 格式）。两处 UUID_RE 重复定义见 S-8。

#### S-4：api-notifications.test.ts L57 fixture recipient_id 含非 hex 'u'（suggestion）

**位置**：`apps/web/test/api-notifications.test.ts:57`（makeNotification fixture `recipient_id: '00000000-0000-4000-8000-0000000000u1'`）
**问题**：fixture recipient_id 含非 hex 字符 'u'，用于 response body 非 safeParse 路径（mock fetch 返回值，不经 createNotificationInputSchema.safeParse 校验），无影响。但与 notification-form.test.tsx VALID_UUID 改为有效 hex UUID（...000001）不一致。
**建议**：同步改为有效 hex UUID `00000000-0000-4000-8000-000000000001` 保持一致性。非 blocker（response body 非 safeParse 路径无影响）。

#### S-5：NotificationListPage PAGE_SIZE=20 常量化（suggestion）

**位置**：`apps/web/src/pages/NotificationListPage.tsx`（PAGE_SIZE=20）+ `apps/web/src/pages/ReportPage.tsx`（PAGE_SIZE=20）
**问题**：PAGE_SIZE=20 显式传（D16，抹平契约缺省 10，N1），对齐 AC-F1-1。两处 PAGE_SIZE=20 重复定义，建议未来 contracts listNotificationQuerySchema.pageSize default 调整为 20 或前端常量化到 shared lib。
**建议**：未来常量化到 apps/web/src/lib/constants.ts 或 contracts default 调整。非 blocker（pageSize=20 显式传功能不弱化）。

#### S-6：ReportPage appliedFilters 分页保持筛选可考虑 URL 持久化（suggestion）

**位置**：`apps/web/src/pages/ReportPage.tsx`（appliedFilters state）
**问题**：appliedFilters state，翻页时保持筛选条件（R13 S-3），对齐 AC-F7-5。但 appliedFilters 仅在内存 state，刷新页面丢失筛选条件。R13 S-2 固化：advisory UX 偏离不须同步 Spec §10 但须 Review 报告记录。
**建议**：未来用 URL query 持久化（如 ?group_by=operator_id&page=2），刷新页面保留筛选。非 blocker（分页保持筛选在内存态生效）。

#### S-7：vitest.config.ts testTimeout 20000 全局生效（suggestion）

**位置**：`vitest.config.ts:31-33`（testTimeout: 20000）
**问题**：testTimeout 20000（默认 5000ms 对 4001 字符 user.type 超时），注释明示"仅放宽超时上限，不掩盖断言失败"。但全局生效，对其他快速测试也放宽超时。
**建议**：未来用 it.timeout 或 per-file 配置仅对超长用例放宽（如 notification-form.test.tsx 单独 testTimeout: 20000）。非 blocker（仅放宽超时上限，断言失败仍报错）。

#### S-8：NotificationForm UUID_RE 与 ReportFilter UUID_RE 重复定义（suggestion）

**位置**：`apps/web/src/components/NotificationForm.tsx`（UUID_RE）+ `apps/web/src/components/ReportFilter.tsx`（UUID_RE）
**问题**：两处 UUID_RE 正则定义重复，功能一致（客户端 advisory 校验 uuid 格式）。
**建议**：未来提取到 apps/web/src/lib/uuid.ts 或 contracts shared lib 复用。非 blocker（两处 UUID_RE 校验逻辑一致，功能不弱化）。

### verdict 判定

- **AC 对齐**：54/54 ✅ + 0 ⚠️ + 0 ❌ ✅
- **规则合规**：AI-001~007 + ARCH-001/002/003 + CODE-001~004 + SEC-001/002/003a/003b + META-001~004 全部合规；ARCH-003 机器化持续合规（lint:rules exit 0 + 逐文件核对 0 违规 + grep 0 实际 import）+ META-003/004 双向绑定持续闭合 + R13 S-4 CODE 扫描器覆盖前端 ✅（无 blocker）
- **advisory 偏离**：8 项（均为纯 UI 文案/常量/UX/测试配置/代码复用类偏离，R13 S-2 不须同步 Spec §10 但须 Review 报告记录）⚠️（suggestion）
- **[约束] 偏离**：0 blocker（D1~D21 全部落地，AC-ARCH-3/ARCH-4 完全对齐）✅
- **多约束组合副作用**：8 条预判全部正确实现 ✅
- **①类显式影响**：navigation.test.tsx 4→6 入口断言调整判定 pass + error-mapping-extend.test.ts 预估不失效 + api-client.test.ts D8 后向兼容核验 ✅
- **impl-writer 测试 setup 改动**：4 处 setup/matcher 改动均合理（UUID hex 校准 + label 消歧 + testTimeout 提升 + navigation 4→6），无断言弱化，AI-002 边界 pass ✅
- **R14 S-11 同步注释闭合**：errorMapping.ts 三处注释更新反映 TRANSFER/ROLE_INHERITANCE 域 FALLBACK ✅
- **blocker**：0 ✅

**verdict**：**pass**（54 AC 全对齐 + ARCH-003 持续合规 + 规则合规无 blocker + 多约束组合副作用全部正确 + ①类显式影响判定 pass + impl-writer 测试 setup 改动判定 pass + R14 S-11 同步注释闭合 + 8 项 suggestion 均为文案/常量/UX/测试配置/代码复用类改进不阻断合入）

### 是否需要 impl-writer 修复后复验

**不需要立即复验**。8 项 suggestion 均为改进类（option text 英文 / 动态列空值兜底 / UUID_RE advisory 校验 / fixture 一致性 / PAGE_SIZE 常量化 / URL 持久化 / testTimeout per-file / UUID_RE 重复定义），不影响功能正确性、AC 对齐、规则合规性（lint:rules exit 0 + ARCH-003 持续合规 + ①类显式影响判定 pass + impl-writer 测试 setup 改动判定 pass）。建议在下一轮演练前由 impl-writer 补齐 8 项 suggestion（特别是 S-4 fixture 一致性 + S-7 testTimeout per-file + S-8 UUID_RE 提取复用，闭合代码一致性/可维护性），但不阻断本轮合入。
