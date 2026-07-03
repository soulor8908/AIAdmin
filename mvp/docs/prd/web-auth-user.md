---
doc_type: PRD-Spec
id: PRD-WEB-AUTH-USER-001
title: 前端鉴权与用户管理（R12 首轮前端，验证 ARCH-003 跨层只经契约）
status: decided
# Q&A 决策结果：Q1=①localStorage / Q2=①统一拦截401跳登录 / Q3=②自动重试1次 / Q4=①环境变量VITE_API_BASE_URL / Q5=②20 / Q6=②提供可选password输入框 / Q7=①仅/login免登录 / Q8=②组件测+API client单测无E2E / Q9=①ErrorCode→中文映射表(SSOT派生) / Q10=①简单loading+按钮禁用 / Q11=①API client适配wire格式(error→code) / Q12=①不启用协商缓存
owner: ba@team
created: 2026-07-03
extends: PRD-AUTH-001
aligns: [PRD-USER-001]
prd_ref: RETRO-ROUND12-001
---

# 前端鉴权与用户管理（R12 首轮前端，验证 ARCH-003 跨层只经契约）

## 背景

前十一轮演练（R1-R11）已完成 admin-system-mvp 后端 MVP：CRUD / 审计埋点 / 报表聚合 / 事务补偿 / 递归继承 / HTTP 条件请求（If-Match 写条件 + ETag 读条件）/ 鉴权域（Bearer token 签发 + 验签中间件 + 登出吊销 + scrypt 密码哈希），778 用例全绿、0 blocker。但**整套系统至今无前端**——所有验证均经 curl / 端到端 fetch 测试驱动，真实用户交互链路（浏览器 → 表单 → API client → router → service）从未端到端跑通。

规则体系里 **ARCH-003「跨层只经契约」** 自立项起即声明「前端只能通过 router 调用，类型来自 @admin/contracts；禁止直连 repository」，但校验方式长期标注 `[预留]`——因为 `apps/web` 不存在，无法落地专属 enforcement。这是分层依赖规则体系的**最大未验证缺口**：ARCH-001/002 已机器化（check-rules.mjs 扫描 apps/api 与 contracts），唯独 ARCH-003 仅靠人工 Review，无 enforcement。

本期（R12）作为**首次引入前端**的轮次，验证以下未覆盖的工作流边界：

1. **ARCH-003 专属校验落地**：本轮须在 `scripts/check-rules.mjs` 新增 ARCH-003 分支——扫描 `apps/web/**/*.{ts,tsx}` 的 import 语句，禁止 import `apps/api/src/**`（尤其 repository/service/domain/router），仅允许 import `@admin/contracts`。这是 ARCH-003 从 `[预留]` 到机器化 enforcement 的首次落地，验证规则反推机制（复盘 §4 规则层）。
2. **跨层契约消费**：前端所有数据类型经 `z.infer` 从 `@admin/contracts` 派生（LoginInput / LoginResult / User / CreateUserInput / UpdateUserStatusInput / ListUserQuery / UserListResult / ErrorCode / ErrorResponse），禁止手写 TS 类型副本（ARCH-002 / CODE-004 在前端侧的延伸）。客户端表单校验**复用 contracts 的 Zod schema**（loginInputSchema / createUserInputSchema / updateUserStatusInputSchema），保证前后端校验规则同源（SSOT）。
3. **真实鉴权链路端到端**：登录页表单 → POST /v1/auth/login → 存 token → 后续请求携带 Bearer → 路由守卫拦截未登录。这是 PRD-AUTH-001 鉴权域在浏览器侧的首次端到端验证（AI-007），覆盖 token 状态机（有效 / 过期 / 吊销）对前端交互的影响。
4. **乐观锁前端处理**：启用/禁用用户经 PATCH /v1/users/:id/status（versioned，须 If-Match header）。前端须处理 VERSION_CONFLICT（409，响应含 current_version）——自动 GET 最新 version 后重试，验证 TECH-OPTIMISTIC-LOCKING-001 在前端交互下的闭合。
5. **零新依赖精神延伸**：HTTP 用原生 fetch 封装 API client，禁止引入 axios 等额外依赖（对齐后端「零新 HTTP 框架」精神）；样式用 CSS Modules / 内联样式，不引入 UI 框架；测试与后端同栈（Vitest + Testing Library）。

本期前端范围严格限定为**鉴权域登录页 + 用户域列表/创建/启停**，对齐 PRD-AUTH-001（登录契约）与 PRD-USER-001（用户功能点）。后端已就绪，**本轮不实现后端任何改动**。

## 业务目标

- **目标1（登录页）**：提供 email + password 表单，提交调 POST /v1/auth/login，成功则存 token 并跳转用户列表页；失败显示 INVALID_CREDENTIALS 错误；表单客户端校验对齐 loginInputSchema（email 格式 + password ≥ 8 位）。
- **目标2（用户列表页）**：分页（page/pageSize）+ 状态筛选（status）展示用户列表，调 GET /v1/users；空状态友好提示；分页信息（total/totalPages）展示。
- **目标3（用户创建）**：表单收集 email + name + 可选 password，调 POST /v1/users；邮箱重复（USER_EMAIL_DUPLICATE）显示明确提示；客户端校验对齐 createUserInputSchema。
- **目标4（启用/禁用）**：列表行操作按钮调 PATCH /v1/users/:id/status，须携带 If-Match: <version>（乐观锁）；VERSION_CONFLICT 自动重试 1 次；禁止禁用自身（USER_DISABLE_SELF_FORBIDDEN）显示明确提示。
- **目标5（前端基础设施）**：apps/web 脚手架（React 18 + TS + Vite）融入现有 monorepo workspace；API client 封装 fetch + Bearer token 注入 + If-Match 注入 + 401 拦截 + VERSION_CONFLICT 重试；token 存储（localStorage）；路由守卫。
- **目标6（ARCH-003 落地与验证）**：check-rules.mjs 新增 ARCH-003 enforcement 扫描 apps/web import；前端源码零 import apps/api/src/repository（及 service/domain/router）；全部类型从 @admin/contracts 派生。验证 ARCH-003 从 `[预留]` 到机器化。
- **目标7（验证工作流适应性）**：验证 spec-first 工作流在前端域的适应性——PRD（BA）→ Tech-Spec + 契约复用（TechLead，本轮契约已就绪无新增）→ 测试先行（Vitest + Testing Library）→ 实现 → Review（ARCH-003 逐文件核对）→ 门禁 G7。重点是 ARCH-003 合规与 AI-007 端到端验收在浏览器侧的闭合。

## 用户故事

- 作为管理员，我希望在浏览器打开登录页，用邮箱+密码登录后进入管理后台，不再依赖 curl 或测试脚本访问系统。
- 作为管理员，我希望登录失败时看到清晰的错误提示（如"邮箱或密码错误"），且表单能在提交前校验邮箱格式与密码长度。
- 作为管理员，我希望在用户列表页分页浏览用户、按状态筛选，并能快速创建新用户或切换用户启停状态。
- 作为管理员，我希望启用/禁用操作遇到并发冲突时系统自动重试一次，而非让我手动处理版本号。
- 作为管理员，我希望禁用自身账号时被明确拒绝并提示"不能禁用自身账号"，避免误操作锁死自己。
- 作为管理员，我希望 token 过期或被吊销时自动跳转回登录页，而非停留在报错页面。
- 作为系统负责人，我希望前端不直接连接后端数据库/仓库层，所有数据经 HTTP API 交换，类型来自共享契约层，保证前后端解耦与安全边界。
- 作为系统负责人，我希望前端密码字段不持久化到任何存储、不记录到日志，token 不输出到 console，符合 PII/敏感字段最小暴露原则。

## 功能点清单

- [ ] F1：登录页（email + password 表单 → POST /v1/auth/login → 存 token → 跳转 /users；客户端校验对齐 loginInputSchema；失败显示 INVALID_CREDENTIALS）
- [ ] F2：用户列表页（GET /v1/users?page&pageSize&status 分页 + 状态筛选；空状态；分页信息展示）
- [ ] F3：用户创建（email + name + 可选 password 表单 → POST /v1/users；邮箱重复提示；客户端校验对齐 createUserInputSchema）
- [ ] F4：启用/禁用（PATCH /v1/users/:id/status + If-Match: <version>；VERSION_CONFLICT 自动重试 1 次；禁止禁用自身提示）
- [ ] F5：前端基础设施（apps/web 脚手架 React 18 + TS + Vite 融入 monorepo；API client 封装 fetch + Bearer + If-Match + 401 拦截 + 冲突重试；零新依赖）
- [ ] F6：路由守卫（未登录访问受保护页跳转 /login；登出清 token 跳 /login；白名单仅 /login）
- [ ] F7：错误处理（401 统一拦截跳登录；ErrorCode→中文提示映射；网络错误兜底；password 不入日志）

## 数据实体草图

**前端无独立数据实体**——全部消费 `@admin/contracts` 经 `z.infer` 派生，禁止手写 TS 类型副本（ARCH-002 / CODE-004 延伸）。本轮契约已就绪，无新增 schema：

- **鉴权域类型**（源自 `packages/contracts/src/schemas/auth.ts`）：
  - `LoginInput = z.infer<typeof loginInputSchema>` → `{ email, password }`（loginInputSchema.strict()，email 用 z.string().email()，password min(8)）
  - `LoginResult = z.infer<typeof loginResultSchema>` → `{ token, expires_at }`（token 非空字符串，expires_at ISO datetime）
  - `LogoutResult = z.infer<typeof logoutResultSchema>` → `{ success: true }`
- **用户域类型**（源自 `packages/contracts/src/schemas/user.ts`）：
  - `User = z.infer<typeof userSchema>` → `{ id, name, email, status, department_id?, created_at, updated_at, version }`（**不含 password_hash**，SEC-003a）
  - `UserStatus = z.infer<typeof userStatusSchema>` → `'active' | 'disabled'`
  - `CreateUserInput = z.infer<typeof createUserInputSchema>` → `{ email, name, password? }`（password optional min(8)）
  - `UpdateUserStatusInput = z.infer<typeof updateUserStatusInputSchema>` → `{ status }`
  - `ListUserQuery = z.infer<typeof listUserQuerySchema>` → `{ page(默认1), pageSize(默认10,max100), status? }`
  - `UserListResult = z.infer<typeof userListResultSchema>` → `{ items, total, page, pageSize, totalPages }`
  - `ErrorCode = z.infer<typeof errorCodeSchema>` → 全局错误码枚举 SSOT
  - `ErrorResponse = z.infer<typeof errorResponseSchema>` → `{ code, message, current_version? }`
- **客户端表单校验复用 Zod schema**：登录用 `loginInputSchema.safeParse()`、创建用户用 `createUserInputSchema.safeParse()`、状态更新用 `updateUserStatusInputSchema.safeParse()`，保证前后端校验规则同源（SSOT，AI-005）。

### token 存储策略

- **存储位置**：`localStorage`，key = `admin_token`（Q1 决策①）。登录成功后写入 `{ token, expires_at }`；登出 / 401 拦截时移除。
- **读取时机**：API client 每次请求从 localStorage 读 token，注入 `Authorization: Bearer <token>` header；路由守卫启动时读 token 判断登录态。
- **安全标注（PII/敏感字段清单）**：
  - `token`：存 localStorage（XSS 可读，MVP 接受，Q1 决策）；**禁止 console.log / 记录到错误日志**；登出立即清除；不写入 sessionStorage / cookie（避免双重存储）。
  - `password`：仅存在于登录/创建用户表单内存，**禁止持久化到 localStorage / sessionStorage / 任何存储**；**禁止 console.log / 记录到错误日志 / 错误响应**；提交后从组件 state 清除。
  - `password_hash`：前端**永不存在**（userSchema 不含此字段，SEC-003a .strict() 拒绝），前端不感知此字段。
  - `email` / `name`：展示用，非高敏，正常渲染。
- **expires_at 使用**：前端不主动判定过期（依赖后端 401 TOKEN_EXPIRED 拦截，Q2 决策），expires_at 仅用于展示"会话将在 X 过期"（可选，MVP 可不展示）。

### API client 设计

封装于 `apps/web/src/api/client.ts`（具体实现由 Tech-Spec / impl 阶段落地，PRD 仅描述行为契约）：

- **基址**：`VITE_API_BASE_URL` 环境变量（Q4 决策①），缺省 `http://localhost:3000`。
- **请求签名**：`request<T>(method, path, opts: { body?, query?, versioned?, expectedVersion? })` → `Promise<T>`。
- **header 注入**：
  - 所有请求（除 login）注入 `Authorization: Bearer <token>`（从 localStorage 读）。
  - versioned 写操作（PATCH status）注入 `If-Match: <expectedVersion>`（调用方传入当前 user.version）。
- **响应处理**：
  - 200 → 解析 JSON，按调用方期望类型返回（类型由 contracts 派生，运行时不强校验响应体，MVP 信任后端契约）。
  - 204 → 返回 `undefined`（void）。
  - 304 → 本轮不发送 If-None-Match，不会触发（Q12 决策①，不启用协商缓存）。
  - 401（UNAUTHORIZED / TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_REVOKED）→ 统一拦截：清 localStorage token，跳转 `/login`（Q2 决策①）。
  - 409 VERSION_CONFLICT → 自动 GET 最新资源取新 version，用新 version 重试一次原请求（Q3 决策②）；重试仍 409 → 抛出冲突错误，由调用方提示用户"数据已被修改，请刷新后重试"。
  - 其余 4xx/5xx → 解析错误体，标准化为 `{ code, message, current_version? }`（ErrorResponse 类型）抛出。
- **错误响应字段名适配（Q11 决策①，关键）**：后端 server.ts 实际 wire 格式为 `{ error: <code>, message, current_version? }`（字段名 `error`），而 contracts `errorResponseSchema` 声明字段名 `code`。API client 在解析层将 wire 的 `error` 字段读出、用 `errorCodeSchema` 校验后映射为 contracts 的 `code` 字段，对外暴露 `ErrorResponse` 类型（contracts 派生）。**前端业务代码只接触 contracts 类型，不感知 wire 字段名差异**。此 contracts/server.ts 字段名不一致记为 Tech-Lead 关注项（advisory，不阻塞前端，因 API client 已适配）。
- **零新依赖**：仅用原生 `fetch` + `URLSearchParams`，禁止引入 axios / ky 等库。

## 验收标准（Given/When/Then）—— AI-007 端到端验收依据

> 全部 AC 须可被前端测试覆盖（Vitest + Testing Library，Q8 决策②）。AC 编号对齐功能点 F1-F7 + ARCH-003 合规专项。

### F1 登录页

- **AC-F1-1 登录成功**：GIVEN seed admin 用户（admin@example.com/admin123）/ WHEN 在登录页填入合法 email+password 并提交 / THEN 调 POST /v1/auth/login 返回 200，token 写入 localStorage（key=admin_token），页面跳转至 /users。
- **AC-F1-2 登录失败 INVALID_CREDENTIALS**：GIVEN admin 用户存在 / WHEN 提交错误密码 / THEN 调 login 返回 401 INVALID_CREDENTIALS，页面显示错误提示（如"邮箱或密码错误"），token 不写入 localStorage，不跳转。
- **AC-F1-3 邮箱不存在同错误码**：GIVEN 无该邮箱 / WHEN 提交 / THEN 返回 401 INVALID_CREDENTIALS，显示与 AC-F1-2 相同提示（不区分"邮箱不存在"，防账号枚举，对齐 PRD-AUTH-001 Q9）。
- **AC-F1-4 表单校验-邮箱格式**：GIVEN 非法邮箱（如 "abc"）/ WHEN 输入并提交 / THEN 客户端 loginInputSchema.safeParse 拦截，显示"邮箱格式不正确"，不发 HTTP 请求。
- **AC-F1-5 表单校验-密码长度**：GIVEN password 长度 < 8 / WHEN 提交 / THEN 客户端校验拦截（对齐 loginInputSchema min(8)），显示"密码至少 8 位"，不发请求。
- **AC-F1-6 表单校验-空字段**：GIVEN email 或 password 为空 / WHEN 提交 / THEN 客户端校验拦截，显示必填提示，不发请求。
- **AC-F1-7 已登录访问登录页跳转**：GIVEN localStorage 已有 token / WHEN 访问 /login / THEN 自动跳转 /users（不重复展示登录表单）。
- **AC-F1-8 提交中按钮禁用**：GIVEN 提交请求进行中 / WHEN 等待响应 / THEN 提交按钮禁用且显示 loading 文案（防重复提交，Q10 决策①）。

### F2 用户列表页

- **AC-F2-1 列表首次加载**：GIVEN 已登录 / WHEN 访问 /users / THEN 调 GET /v1/users?page=1&pageSize=20（pageSize 默认 20，Q5 决策②），渲染 items（每行展示 name/email/status + 操作按钮）。
- **AC-F2-2 分页切换**：GIVEN total > pageSize（多页）/ WHEN 点击第 2 页 / THEN 调 GET /v1/users?page=2&pageSize=20，渲染第 2 页数据。
- **AC-F2-3 状态筛选**：GIVEN 列表含 active+disabled 用户 / WHEN 选择 status=disabled 筛选 / THEN 调 GET /v1/users?status=disabled，仅渲染 disabled 用户。
- **AC-F2-4 筛选+分页复合**：GIVEN 已选 status=disabled 且多页 / WHEN 翻页 / THEN 调 GET /v1/users?page=2&pageSize=20&status=disabled，保持筛选条件。
- **AC-F2-5 空状态**：GIVEN 无满足条件用户 / THEN 列表区域显示空状态文案（如"暂无用户"），不报错。
- **AC-F2-6 分页信息展示**：GIVEN 响应含 total/totalPages / THEN 页面展示"共 X 条，第 Y/Z 页"。
- **AC-F2-7 加载态**：GIVEN 请求进行中 / THEN 列表区域显示 loading 文案（Q10 决策①，不做骨架屏）。

### F3 用户创建

- **AC-F3-1 创建成功**：GIVEN 合法 email+name（未占用）/ WHEN 提交 / THEN 调 POST /v1/users 返回 User，弹窗关闭，列表刷新含新用户，新用户状态默认 active。
- **AC-F3-2 邮箱重复**：GIVEN email 已被占用 / WHEN 提交 / THEN 返回 USER_EMAIL_DUPLICATE，表单显示"邮箱已存在"。
- **AC-F3-3 表单校验-邮箱格式**：GIVEN 非法 email / WHEN 提交 / THEN 客户端 createUserInputSchema.safeParse 拦截，显示"邮箱格式不正确"，不发请求。
- **AC-F3-4 表单校验-姓名空**：GIVEN name 为空 / WHEN 提交 / THEN 客户端校验拦截，显示"姓名必填"，不发请求。
- **AC-F3-5 password 可选**：GIVEN 不填 password / WHEN 提交 / THEN 请求体不含 password 字段（对齐 createUserInputSchema password optional），创建成功（后端生成临时密码）。
- **AC-F3-6 password 填写则校验长度**：GIVEN 填了 password 但 < 8 位 / WHEN 提交 / THEN 客户端校验拦截（min(8)），显示"密码至少 8 位"，不发请求。

### F4 启用/禁用

- **AC-F4-1 禁用成功**：GIVEN active 用户（version=N）/ WHEN 点击"禁用" / THEN 调 PATCH /v1/users/:id/status + If-Match: N，body={status:'disabled'}，返回 200 User，列表刷新该用户状态变 disabled。
- **AC-F4-2 启用成功**：GIVEN disabled 用户 / WHEN 点击"启用" / THEN 调 PATCH body={status:'active'}，成功后状态变 active。
- **AC-F4-3 VERSION_CONFLICT 自动重试**：GIVEN 列表 user.version=N 但实际已变 N+1 / WHEN PATCH 返回 409 VERSION_CONFLICT（含 current_version=N+1）/ THEN API client 自动 GET 最新 user 取 version=N+1，用新 version 重试 PATCH 一次，成功后列表刷新。
- **AC-F4-4 重试仍冲突提示**：GIVEN 重试后仍返回 409 / THEN 显示"数据已被修改，请刷新后重试"，不无限重试（仅 1 次，Q3 决策②）。
- **AC-F4-5 禁止禁用自身**：GIVEN 目标用户 id === 当前登录用户 id（token 解析的 sub）/ WHEN 点击"禁用" / THEN 后端返回 USER_DISABLE_SELF_FORBIDDEN，前端显示"不能禁用自身账号"。
- **AC-F4-6 重复状态提示**：GIVEN 对已 disabled 用户点"禁用" / THEN 后端返回 USER_ALREADY_DISABLED，前端显示"用户已是禁用状态"（对齐 PRD-USER-001 F3）。
- **AC-F4-7 API client 始终带 If-Match**：GIVEN 任意 PATCH status 请求 / THEN API client 注入 If-Match: <user.version> header（缺失则后端返回 VERSION_REQUIRED，前端不应触发此码，因 API client 保证注入）。

### F5 前端基础设施

- **AC-F5-1 API client 统一封装**：GIVEN 任意前端 HTTP 调用 / THEN 经 `apps/web/src/api/client.ts` 的 request() 发出，不直接调用 fetch（除 client 内部）。
- **AC-F5-2 Bearer token 自动注入**：GIVEN 已登录（localStorage 有 token）/ WHEN 任意受保护请求 / THEN 请求头含 `Authorization: Bearer <token>`。
- **AC-F5-3 If-Match 自动注入**：GIVEN versioned 写操作（PATCH status）/ WHEN 调用 / THEN 请求头含 `If-Match: <expectedVersion>`。
- **AC-F5-4 类型全部 contracts 派生**：GIVEN apps/web 源码任意类型引用 / THEN 经 `z.infer` 从 `@admin/contracts` 派生，无手写 User/ErrorCode/LoginResult 等 TS 类型副本。
- **AC-F5-5 零新依赖**：GIVEN apps/web/package.json / THEN HTTP 用原生 fetch（无 axios/ky），路由用 react-router-dom，状态用 React Context + 本地 state，测试用 vitest + @testing-library，无额外 HTTP/状态/UI 框架依赖。
- **AC-F5-6 monorepo 融入**：GIVEN 根 workspace 配置 / THEN apps/web 作为 workspace 包接入（pnpm/npm workspaces），可引用 `@admin/contracts`（packages/contracts）。

### F6 路由守卫

- **AC-F6-1 未登录访问受保护页跳转**：GIVEN localStorage 无 token / WHEN 访问 /users / THEN 跳转 /login（不渲染 /users 内容）。
- **AC-F6-2 登出跳转**：GIVEN 已登录 / WHEN 点击"登出" / THEN 调 POST /v1/auth/logout（成功 200），清除 localStorage token，跳转 /login。
- **AC-F6-3 登出后受保护页不可访问**：GIVEN 登出后（token 已清）/ WHEN 访问 /users / THEN 跳转 /login。
- **AC-F6-4 白名单仅 /login**：GIVEN 任意路由 / WHEN 无 token 访问 / THEN 仅 /login 可直接访问，其余路由均跳转 /login（Q7 决策①）。
- **AC-F6-5 登出后原 token 失效**：GIVEN 登出后 / WHEN 用原 token 调任意受保护路由 / THEN 后端返回 401 TOKEN_REVOKED（对齐 PRD-AUTH-001 AC-F4-2）。

### F7 错误处理

- **AC-F7-1 401 统一拦截跳登录**：GIVEN 任意请求返回 401（UNAUTHORIZED/TOKEN_INVALID/TOKEN_EXPIRED/TOKEN_REVOKED）/ WHEN API client 收到 / THEN 清除 localStorage token，跳转 /login（Q2 决策①）。
- **AC-F7-2 ErrorCode→中文提示映射**：GIVEN 各 ErrorCode / THEN 前端映射表输出对应中文提示（USER_EMAIL_DUPLICATE→"邮箱已存在"、USER_DISABLE_SELF_FORBIDDEN→"不能禁用自身账号"、USER_ALREADY_DISABLED→"用户已是禁用状态"、USER_ALREADY_ACTIVE→"用户已是启用状态"、INVALID_CREDENTIALS→"邮箱或密码错误"、VERSION_CONFLICT→"数据已被修改，请刷新后重试"、其余未映射码→"操作失败，请稍后重试"）。映射表键须从 errorCodeSchema SSOT 派生（AI-005）。
- **AC-F7-3 网络错误兜底**：GIVEN fetch 抛错（网络断开/服务不可达）/ THEN 显示"网络异常，请稍后重试"，不白屏。
- **AC-F7-4 password 不入日志**：GIVEN 任意前端日志（console / 错误上报）/ THEN password 字段不被记录（PII 安全，SEC-003b 延伸）；错误响应体不含 password（后端保证，前端不输出）。
- **AC-F7-5 token 不入日志**：GIVEN 任意前端日志 / THEN token 字符串不被 console.log / 记录（PII 安全）。

### ARCH-003 合规专项（R12 核心验证点）

- **AC-ARCH-1 前端不直连 repository**：GIVEN apps/web 源码全部 .ts/.tsx 文件 / THEN 无任何 import 语句指向 `apps/api/src/repository/**`（亦不指向 service/domain/router/server）。
- **AC-ARCH-2 类型来自 contracts**：GIVEN apps/web 源码 / THEN 数据类型（User/LoginResult/ErrorCode 等）import 自 `@admin/contracts`，无手写 TS 类型副本（ARCH-002/CODE-004 延伸）。
- **AC-ARCH-3 校验脚本落地**：GIVEN `scripts/check-rules.mjs` / THEN ARCH-003 分支扫描 `apps/web/**/*.{ts,tsx}` import 语句，发现 import `apps/api/src/**`（repository/service/domain/router）即报错 exit≠0；此 enforcement 本轮从 `[预留]` 落地为机器化校验。
- **AC-ARCH-4 客户端校验复用契约 schema**：GIVEN 登录/创建用户/状态更新表单 / THEN 客户端 safeParse 复用 loginInputSchema / createUserInputSchema / updateUserStatusInputSchema（SSOT 派生，AI-005），不手写校验正则副本。

## Q&A 决策（全 BLOCKING，未回答不进入 Spec）

**Q1 · token 存储位置？**
BLOCKING（影响数据实体草图 / AC-F1-1 / AC-F6-× / 安全域）。方案①localStorage（持久化，刷新不丢，XSS 可读）；方案②sessionStorage（关闭标签即失效，XSS 可读，刷新不丢但关标签丢）；方案③httpOnly cookie（防 XSS 读取，但需后端 CORS + SameSite 配置，且 CSRF 防护）。本期选哪个？推荐①（MVP 简化，刷新保持登录态体验好；XSS 风险接受，靠前端不执行不可信内容缓解；httpOnly cookie 需后端改动，违背"不改后端"约束）。**阻塞下游：Tech-Spec API client 设计、impl token 存储实现、test 路由守卫用例。**

**Q2 · 401 拦截策略？**
BLOCKING（影响 AC-F7-1 / 用户体验 / 边界）。方案①API client 统一拦截所有 401（UNAUTHORIZED/TOKEN_INVALID/TOKEN_EXPIRED/TOKEN_REVOKED），清 token 跳 /login；方案②仅拦截 TOKEN_EXPIRED/TOKEN_REVOKED，其余 401 由调用方处理；方案③不拦截，全交调用方。本期选哪个？推荐①（token 过期/吊销是常见场景，统一拦截避免每个调用方重复处理；登录页本身的 401 INVALID_CREDENTIALS 不走此拦截——login 路由是 public，401 是业务错误非鉴权失败，API client 须区分"鉴权类 401"与"登录凭据错 401"，后者原样抛给登录页）。**阻塞下游：Tech-Spec API client 401 拦截设计、impl 拦截实现、test 401 跳转用例。**

**Q3 · VERSION_CONFLICT 重试策略？**
BLOCKING（影响 AC-F4-3 / AC-F4-4 / 乐观锁前端闭合）。方案①不自动重试，直接提示用户"数据已修改，请刷新"；方案②自动重试 1 次（GET 最新 version 后重试原请求），仍冲突再提示；方案③自动重试 N 次（N>1）。本期选哪个？推荐②（自动重试 1 次覆盖绝大多数并发场景，用户体验好；无限重试有活锁风险；不重试则乐观锁前端价值减半。重试须仅对幂等性可接受的状态切换操作，PATCH status 满足）。**阻塞下游：Tech-Spec API client 重试逻辑、impl 重试实现、test 冲突重试用例。**

**Q4 · API client 基址配置？**
BLOCKING（影响 AC-F5-1 / 部署 / 环境隔离）。方案①环境变量 `VITE_API_BASE_URL`（缺省 http://localhost:3000），构建时注入；方案②硬编码 http://localhost:3000；方案③运行时配置文件。本期选哪个？推荐①（Vite 标准 env 机制，开发/生产环境隔离；硬编码无法部署；运行时配置增加复杂度，MVP 不需要）。**阻塞下游：impl Vite env 配置、test 测试基址。**

**Q5 · 列表页 pageSize 默认值？**
BLOCKING（影响 AC-F2-1 / 数据实体 ListUserQuery）。方案①10（对齐 listUserQuerySchema 缺省）；方案②20（每页更多数据，减少翻页）；方案③50。本期选哪个？推荐②（管理后台 20 条/页是常见体验平衡，listUserQuerySchema max 100 允许；10 偏少翻页频繁，50 偏多单页重）。**阻塞下游：impl 列表页默认参数、test 分页用例。**

**Q6 · 创建用户时 password 缺省策略？**
BLOCKING（影响 AC-F3-5 / AC-F3-6 / 表单设计）。方案①前端不提供 password 输入框，始终不传 password（后端生成临时密码）；方案②前端提供可选 password 输入框，空则不传、填则校验 min(8)；方案③前端必填 password。本期选哪个？推荐②（对齐 createUserInputSchema password optional 语义，给管理员选择权；必填增加创建摩擦；不提供则无法设置初始密码，依赖后端临时密码且前端不可见）。**阻塞下游：impl 创建用户表单、test 创建用例。**

**Q7 · 路由守卫白名单？**
BLOCKING（影响 AC-F6-4 / 边界）。方案①白名单仅 /login（其余全部须登录）；方案②白名单 /login + /health（前端无 health 页，N/A）；方案③无白名单（全部须登录，登录页自身例外）。本期选哪个？推荐①（最小白名单，受保护语义清晰；MVP 无公开页需求）。**阻塞下游：impl 路由守卫、test 守卫用例。**

**Q8 · 前端测试范围？**
BLOCKING（影响验收可测性 / 工作量估算）。方案①仅组件测（Vitest + Testing Library 渲染+交互）；方案②组件测 + API client 单测（mock fetch 验封装逻辑）+ 路由守卫测，不做 E2E；方案③组件测 + E2E（Playwright 跑真实浏览器+真实后端）。本期选哪个？推荐②（组件测覆盖 UI 交互，API client 单测覆盖 token 注入/401 拦截/冲突重试逻辑，路由守卫测覆盖跳转；E2E 引入 Playwright 重且慢，MVP 靠 spawn 真实 server + fetch 的契约测已在后端覆盖 HTTP 层，前端 E2E 边际价值低）。**阻塞下游：test-writer 测试矩阵、impl 测试实现。**

**Q9 · 错误码到用户提示的映射策略？**
BLOCKING（影响 AC-F7-2 / 用户体验 / AI-005 SSOT）。方案①前端维护 ErrorCode→中文提示映射表，键从 errorCodeSchema SSOT 派生（`[...errorCodeSchema.options]`），未映射码显示通用"操作失败"；方案②直接显示后端 message 原文；方案③硬编码全部码（非 SSOT）。本期选哪个？推荐①（SSOT 派生保证枚举扩展时映射表不漏，AI-005；后端 message 是英文/技术向，不适合直接展示给管理员；硬编码违背 SSOT）。**阻塞下游：impl 错误映射表、test 映射用例。**

**Q10 · 是否需要加载态/骨架屏？**
BLOCKING（影响 AC-F1-8 / AC-F2-7 / 用户体验）。方案①简单 loading 文案 + 按钮禁用态；方案②骨架屏（Skeleton）；方案③无加载态。本期选哪个？推荐①（MVP 简化，loading 文案+按钮禁用足够防重复提交与提示等待；骨架屏增加样式工作量，MVP 不引入 UI 框架下实现成本高；无加载态体验差且易重复提交）。**阻塞下游：impl 加载态组件、test 加载态用例。**

**Q11 · 错误响应字段名对齐（contracts `code` vs server wire `error`）？**
BLOCKING（影响 AC-F5-4 / ARCH-003 类型来自 contracts / API client 设计）。**发现**：contracts `errorResponseSchema` 声明字段名 `code`，但后端 server.ts 实际响应体字段名为 `error`（`{ error: <code>, message, current_version? }`），二者不一致。方案①API client 解析层适配 wire 格式——读 `error` 字段、用 errorCodeSchema 校验、映射为 contracts 的 `code` 字段，对外暴露 ErrorResponse 类型（contracts 派生），前端业务代码不感知差异；方案②前端类型直接按 wire 格式手写（违背 ARCH-003 类型来自 contracts）；方案③本期改后端对齐 contracts（违背"不改后端"约束）。本期选哪个？推荐①（前端零感知 wire 差异，ARCH-003 合规；contracts/server.ts 字段名不一致记为 Tech-Lead 关注项 advisory，不阻塞前端，因 API client 已适配；未来可由后端对齐字段名消除差异）。**阻塞下游：Tech-Spec API client 错误解析设计、impl 错误解析实现、test 错误用例。**

**Q12 · ETag/304 协商缓存处理？**
BLOCKING（影响 AC-F2-× / API client 设计 / 边界）。方案①前端不发送 If-None-Match，始终接受 200 全量响应（不启用协商缓存）；方案②前端缓存 ETag，发送 If-None-Match，处理 304 复用缓存。本期选哪个？推荐①（MVP 简化，list 数据量小，全量响应成本可接受；协商缓存增加 API client 缓存层复杂度，且 304 空体处理在测试中易出错；后端 ETag 支持保留，未来前端可启用，不破坏契约）。**阻塞下游：impl API client 响应处理、test 列表用例。**

## Out of scope

- **角色管理页 / 部门管理页 / 审计日志页 / 通知页 / 报表页** —— 本轮仅鉴权域登录页 + 用户域列表/创建/启停，其余管理域前端为未来轮次。
- **refresh token / 双 token 机制** —— 本轮仅 access token，refresh 为未来会话管理方向（对齐 PRD-AUTH-001 Q1）。
- **注册 / 自助 signup** —— 用户由 admin 创建，注册为未来方向（对齐 PRD-AUTH-001 Out of scope）。
- **密码重置 / 忘记密码** —— 本轮不涉及，为未来方向。
- **OAuth / SSO / 第三方登录** —— 本轮仅本地账号，第三方为未来方向。
- **SSR / 服务端渲染** —— 本轮 CSR（Vite SPA），SSR 为未来方向。
- **PWA / 离线支持** —— 本轮不涉及。
- **国际化（i18n）** —— 本轮仅中文提示，i18n 为未来方向。
- **暗色模式 / 主题切换** —— 本轮基础样式，主题为未来方向。
- **E2E 测试（Playwright）** —— 本轮仅组件测 + API client 单测（Q8 决策②），E2E 为未来工程化方向。
- **协商缓存（If-None-Match/304）前端启用** —— 本轮不启用（Q12 决策①），后端 ETag 支持保留。
- **骨架屏（Skeleton）** —— 本轮仅简单 loading 文案（Q10 决策①）。
- **UI 组件库（antd/MUI 等）** —— 本轮不引入，CSS Modules / 内联样式（零新依赖精神）。
- **后端任何改动** —— 后端已就绪（778 用例全绿），本轮仅前端，contracts 无新增 schema。
- **check-rules.mjs 之外的新规则** —— 本轮仅落地 ARCH-003 enforcement，不新增其他规则。
