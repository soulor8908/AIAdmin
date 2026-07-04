---
doc_type: Tech-Spec
id: TECH-WEB-AUTH-USER-001
title: 前端鉴权与用户管理（R12 首轮前端，验证 ARCH-003 跨层只经契约）Tech-Spec
prd_ref: PRD-WEB-AUTH-USER-001
status: ready
owner: tech-lead@team
created: 2026-07-03
extends: TECH-AUTH-001
aligns: [TECH-USER-001, TECH-OPTIMISTIC-LOCKING-001]
---

# TECH-WEB-AUTH-USER-001 · 前端鉴权与用户管理 Tech-Spec

> 派生自 PRD-WEB-AUTH-USER-001（status=decided，12 个 BLOCKING Q&A 已拍板，48 条 AC）。
> **契约层本轮无新增**：packages/contracts 已就绪，前端全部复用既有 Zod schema + z.infer 类型。本 Spec 不改 contracts。
> **后端本轮冻结**：不改 service/repo/domain/router/server.ts（后端 778 用例全绿，PRD 明示"不改后端"）。
> 本阶段只产本文档；apps/web 源码、check-rules.mjs ARCH-003 分支、layering.md 校验方式更新、工程配置文件均由 impl-writer 阶段落地（§6/§7/§8/§12 描述为设计 + [advisory] 实现提示）。
> R12 核心验证点：ARCH-003「跨层只经契约」从 `[预留]` 落地为机器化 enforcement（§8）。

## 1. 覆盖范围与既有端点核验（R10 S-2 教训闭合）

R10 S-2 教训：Spec 须核验既有路由表，确认前端调用的端点均存在、非覆盖既有路由。本节核验 `apps/api/src/server.ts` routes 数组（L221~L374）。

### 1.1 前端调用端点清单（逐条核验）

| # | 端点 | method | server.ts 行 | auth | versioned | cacheable | 核验结论 |
|---|------|--------|--------------|------|-----------|-----------|----------|
| E1 | `/v1/auth/login` | POST | L224 | public | false | false | 存在，public 路由无需 token（AC-F1-5） |
| E2 | `/v1/auth/logout` | POST | L227-237 | admin | false | false | 存在，buildInput 从 Authorization header 提取 token |
| E3 | `/v1/users` | GET | L240 | admin | false | true | 存在，cacheable（后端生成 ETag，前端不发送 If-None-Match，Q12） |
| E4 | `/v1/users` | POST | L241 | admin | false | false | 存在，创建用户 |
| E5 | `/v1/users/:id/status` | PATCH | L242-246 | admin | **true** | false | 存在，versioned=true（须 If-Match header，D7） |

核验结论：**前端调用的 5 个端点全部存在于既有路由表**，本轮不新增任何后端端点。R10 S-2 教训闭合。

### 1.2 关键发现：GET /v1/users/:id 端点（R18 已补齐，D19 已消除）

PRD AC-F4-3 原文："API client 自动 **GET 最新 user** 取 version=N+1，用新 version 重试 PATCH 一次"。

R12 核验 routes 数组（L221~L374）发现：用户域仅 `GET /v1/users`（列表）、`POST /v1/users`（创建）、`PATCH /v1/users/:id/status`（状态更新）、`POST /v1/users/:userId/transfer`（调岗），**无 `GET /v1/users/:id` 单条详情端点**，导致 PRD AC-F4-3 字面"GET 最新 user"无法落地。R12 改用 409 响应体 `current_version` 重试（D9），D19 记为 [advisory] 偏离（端点 gap）。

**R18 已消除（TECH-USER-DETAIL-WIRE-001 D2）**：`GET /v1/users/:id` 端点已补齐（admin + user:read + cacheable + detailEtag），D19 [advisory] 标注移除（端点 gap 闭合）。D9 重分类为 `[约束]`（D9 重分类决策详见 §10 D9，client 设计选择 409-retry，非因端点缺失的临时妥协——Q6 决策①）。前端 future 轮次可消费 `getUser(id)`（AC-G13 future-ready）。

### 1.3 本期覆盖范围（PRD F1~F7 + ARCH-003）

- F1 登录页 → E1
- F2 用户列表页 → E3
- F3 用户创建 → E4
- F4 启用/禁用 → E5（+ 409 current_version 重试，D9）
- F5 前端基础设施 → API client 封装 E1~E5
- F6 路由守卫 → 前端纯客户端逻辑（白名单 /login）
- F7 错误处理 → API client + 错误映射表
- ARCH-003 合规专项 → §8 check-rules.mjs 新增分支

## 2. 前端分层架构（apps/web/src 目录结构）

### 2.1 目录结构

```
apps/web/
├── package.json                 # D5/D17 依赖声明
├── tsconfig.json                # §12 继承根 tsconfig + jsx:react-jsx
├── vite.config.ts               # §12 Vite + alias @admin/contracts
├── index.html                   # SPA 入口
└── src/
    ├── main.tsx                 # 应用挂载（ReactDOM.createRoot + RouterProvider）
    ├── App.tsx                  # 路由表（§7）+ AuthProvider 包裹
    ├── api/
    │   ├── client.ts            # fetch 封装 request<T>（§4，核心）
    │   ├── auth.ts              # login/logout endpoint 封装（调 client）
    │   └── users.ts             # listUsers/createUser/updateUserStatus endpoint 封装
    ├── auth/
    │   ├── tokenStore.ts        # localStorage 读写（leaf，无依赖，D12）
    │   ├── AuthContext.tsx      # 登录态 Context + login/logout action（§5）
    │   └── RouteGuard.tsx       # 路由守卫组件（§5/§7）
    ├── pages/
    │   ├── LoginPage.tsx        # F1 登录页
    │   └── UserListPage.tsx     # F2/F3/F4 列表+创建+启停
    ├── components/
    │   ├── CreateUserModal.tsx  # F3 创建用户弹窗
    │   ├── UserRow.tsx          # 列表行（name/email/status + 启停按钮）
    │   └── ErrorBanner.tsx      # 内联错误提示
    └── lib/
        └── errorMapping.ts      # ErrorCode→中文映射表（SSOT 派生，D11）
```

### 2.2 各层职责与依赖方向

| 层 | 职责 | 允许依赖 | 禁止依赖 |
|----|------|----------|----------|
| `lib/` | 纯工具（错误码映射） | @admin/contracts | 任何 IO 层 |
| `auth/tokenStore.ts` | localStorage 读写 token | @admin/contracts（LoginResult 类型） | api/、pages/、components/ |
| `api/client.ts` | fetch 封装、header 注入、401 拦截、409 重试、错误体读 raw.code（D10 已消除） | @admin/contracts、auth/tokenStore、lib/errorMapping | pages/、components/ |
| `api/auth.ts`、`api/users.ts` | endpoint 封装（拼 path/query/body 调 client） | api/client、@admin/contracts | pages/、components/ |
| `auth/AuthContext.tsx` | 登录态管理 + login/logout action | api/auth、auth/tokenStore、@admin/contracts | pages/、components/（避免循环） |
| `auth/RouteGuard.tsx` | 路由守卫 | auth/AuthContext、react-router-dom | api/（不直接发请求） |
| `pages/` | 页面组件（状态 + 交互） | api/users、auth/AuthContext、components/、@admin/contracts | 直连 fetch（须经 api/client，AC-F5-1） |
| `components/` | 复用组件 | @admin/contracts、lib/ | api/、pages/ |

**依赖方向单向**：`pages/components → api → {client → tokenStore/lib}`；`pages → auth/AuthContext → api/auth → client`。`tokenStore` 与 `lib/` 为叶子层，无下游依赖。`api/client.ts` 读 token 经 `tokenStore`（非 AuthContext），避免 `api ↔ auth` 循环依赖。

### 2.3 ARCH-003 在分层上的体现

ARCH-003「跨层只经契约」在分层上的落点：**apps/web/src 全部模块只能 import `@admin/contracts`（类型 + Zod schema）+ 第三方依赖（react/react-router-dom）+ apps/web/src 内部模块**；禁止 import `apps/api/src/**` 任何模块（repository/service/domain/router/server）与 `@admin/api` 包。后端能力只能经 HTTP（api/client → router 端点）调用，类型只能经 contracts 派生。机器化校验见 §8。

## 3. 数据契约消费（类型派生 + schema 复用，ARCH-002/CODE-004 延伸）

### 3.1 从 @admin/contracts 派生的类型清单

> 全部类型经 `z.infer` 派生，**禁止手写 TS 类型副本**（D3 [约束]，ARCH-002/CODE-004 延伸）。

**鉴权域**（源自 `packages/contracts/src/schemas/auth.ts`）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `LoginInput` | `z.infer<typeof loginInputSchema>` | 登录表单提交体（{ email, password }） |
| `LoginResult` | `z.infer<typeof loginResultSchema>` | 登录响应（{ token, expires_at }），存入 tokenStore |
| `LogoutResult` | `z.infer<typeof logoutResultSchema>` | 登出响应（{ success: true }） |

**用户域**（源自 `packages/contracts/src/schemas/user.ts`）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `User` | `z.infer<typeof userSchema>` | 用户实体（列表/创建响应，**不含 password_hash**） |
| `UserStatus` | `z.infer<typeof userStatusSchema>` | 'active' \| 'disabled'，状态筛选 + 启停 |
| `CreateUserInput` | `z.infer<typeof createUserInputSchema>` | 创建用户表单提交体（{ email, name, password? }） |
| `UpdateUserStatusInput` | `z.infer<typeof updateUserStatusInputSchema>` | 状态更新提交体（{ status }） |
| `ListUserQuery` | `z.infer<typeof listUserQuerySchema>` | 列表查询参数（{ page, pageSize, status? }） |
| `UserListResult` | `z.infer<typeof userListResultSchema>` | 列表响应（{ items, total, page, pageSize, totalPages }） |
| `ErrorCode` | `z.infer<typeof errorCodeSchema>` | 全局错误码枚举 SSOT（错误映射键） |
| `ErrorResponse` | `z.infer<typeof errorResponseSchema>` | 标准化错误体（{ code, message, current_version? }，API client 适配后对外暴露） |

**禁用类型**（[约束] D3）：前端**禁止 import** `userEntitySchema` / `UserEntity`（含 `password_hash`，存储实体，后端内部专用，SEC-003a）。前端不感知 `password_hash` 字段存在。同理禁止 import `tokenPayloadSchema` / `TokenPayload`（后端验签内部用，token 对前端不透明，PRD 不解析 payload）。

### 3.2 客户端表单校验 schema 复用清单（SSOT 派生，AI-005）

> 复用 contracts Zod schema 的 `.safeParse()`，**禁止手写校验正则副本**（D4 [约束]）。

| 功能点 | 复用 schema | 校验点 | AC |
|--------|-------------|--------|----|
| F1 登录 | `loginInputSchema.safeParse` | email 格式 + password min(8) + 拒绝多余字段 | AC-F1-4/5/6 |
| F3 创建用户 | `createUserInputSchema.safeParse` | email 格式 + name min(1) + password optional min(8) | AC-F3-3/4/6 |
| F4 状态更新 | `updateUserStatusInputSchema.safeParse` | status ∈ {active, disabled} | AC-F4-1/2 |

`listUserQuerySchema` 的 `pageSize` schema 缺省为 10，但 PRD Q5 决策②要求前端默认 20。前端**显式传 pageSize=20**，不依赖 schema 缺省（D14 [约束]）；schema 的 max(100) 仍约束上限。

## 4. API client 设计（apps/web/src/api/client.ts）

### 4.1 请求签名与基址

```ts
type RequestOptions = {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  versioned?: boolean;        // true → 注入 If-Match
  expectedVersion?: number;   // If-Match 的值（user.version）
  skipAuth?: boolean;         // true → 不注入 Bearer（仅 login 用）
};
function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T>;
```

- 基址：`import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'`（Q4 决策①，D5）。
- query 拼接：原生 `URLSearchParams`（D5 零新依赖）。
- body 序列化：`JSON.stringify` + `Content-Type: application/json`。

### 4.2 Header 注入

- **Bearer token**（D6 [约束]）：除 `skipAuth=true`（login）外，从 `tokenStore.getToken()` 读 token，注入 `Authorization: Bearer <token>`。无 token 时仍发请求（受保护路由后端返回 401 → 拦截跳登录）。
- **If-Match**（D7 [约束]）：`opts.versioned === true` 且 `opts.expectedVersion !== undefined` 时，注入 `If-Match: <expectedVersion>`。PATCH status 调用方传入当前 `user.version`。API client 保证注入（AC-F4-7：缺失则后端返 VERSION_REQUIRED，前端不应触发此码）。

### 4.3 响应处理

| HTTP | 处理 | AC |
|------|------|----|
| 200 | `res.json()` → 按 `<T>` 返回（运行时不强校验响应体，MVP 信任后端契约；类型由 contracts 派生） | — |
| 204 | 返回 `undefined`（void） | — |
| 304 | 本轮不发送 If-None-Match，不会触发（Q12 决策①，D15） | — |
| 401 | 见 §4.4 拦截逻辑 | AC-F7-1 |
| 409 | 见 §4.5 冲突重试 | AC-F4-3/4 |
| 其余 4xx/5xx | 解析错误体（§4.6，D10 已消除，直接读 raw.code）→ 抛 `ApiError` | AC-F7-2 |
| fetch 抛错（网络） | 抛 `{ code: 'NETWORK_ERROR', message: '网络异常，请稍后重试' }`（非 contracts 码，前端本地兜底） | AC-F7-3 |

### 4.4 401 拦截（D8 [约束]）

```
response.status === 401:
  解析错误体 → 取 code（§4.6，D10 已消除，直接读 raw.code）
  if code ∈ { UNAUTHORIZED, TOKEN_INVALID, TOKEN_EXPIRED, TOKEN_REVOKED }:
    tokenStore.clearToken()
    跳转 /login（window.location 或 router navigate）
    抛出鉴权错误（终止调用链）
  else if code === 'INVALID_CREDENTIALS':
    // login 业务错误（凭据错），非鉴权失败，原样抛给登录页（Q2 决策①）
    抛出 ErrorResponse，不跳转、不清 token
```

**关键区分**（Q2 决策①）：401 须按响应体 `code` 区分"鉴权类 401"（4 码，拦截跳登录）与"登录凭据错 401"（INVALID_CREDENTIALS，原样抛登录页）。判定顺序：先解析错误体取 code（§4.6，D10 已消除，直接读 raw.code），再按 code 分支。login 请求本身 `skipAuth=true`，其 401 必为 INVALID_CREDENTIALS。

### 4.5 VERSION_CONFLICT 重试（D9 [约束]，R18 重分类）

```
response.status === 409:
  解析错误体 → 取 code + current_version（§4.6，D10 已消除，直接读 raw.code）
  if code === 'VERSION_CONFLICT' && current_version !== undefined && 本次未重试过:
    用 current_version 作为新 expectedVersion，重试原 PATCH 请求 1 次（Q3 决策②）
    重试响应再走 §4.3/4.4 分支（重试的 401 仍拦截跳登录，不重试）
  else:
    抛出 ErrorResponse（含 current_version），调用方提示"数据已被修改，请刷新后重试"
```

**重试来源**：直接用 409 响应体的 `current_version`（D9 [约束]，R18 重分类）。重试仅 1 次（Q3 决策②，防活锁）。重试仅对 PATCH status（幂等可接受的状态切换，Q3）。R18（TECH-USER-DETAIL-WIRE-001 D3）后 `GET /v1/users/:id` 端点已补齐（§1.2，D19 已消除），但 client 仍保留 409-retry 策略——D9 从原 [advisory]-adjacent 重分类为正式 `[约束]` 设计决策（client 选择 409-retry 而非 GET-retry：无额外 round trip + 已测试工作 + GET-retry 须处理 GET 也 409 的边缘场景，复杂度更高，Q6 决策①）。重试不切换为 GET-retry，但端点存在为 future 用户详情页消费 + GET-retry 可选项提供基础。

### 4.6 wire 字段名对齐 code（D10 已消除 R18）

**R12 历史问题**：contracts `errorResponseSchema` 字段名 `code`，server.ts L594 实际响应 `{ error: e.code, message: e.message, ...meta }`，字段名 `error`。二者不一致（后端历史遗留，D10 [advisory]）。另 server.ts L562-566 VALIDATION_ERROR 响应额外带 `issues` 字段（contracts 未声明，D21 [advisory]）。

**R18 已消除（TECH-USER-DETAIL-WIRE-001 D1，Q1 接受 breaking change）**：server.ts 全部 7 处错误响应 wire 字段名 `error` → `code`，与 contracts `errorResponseSchema.code` 对齐。client `parseErrorResponse` 删除 wire 适配层，直接读 `raw.code`。三层字段名（contracts `code` / server `code` / client `raw.code`）一致。

**消除后设计**（D10 已消除，保留 safeParse + fallback + 手动读字段）：
```ts
function parseErrorResponse(body: unknown): ParsedError {
  // body wire 格式：{ code: <ErrorCode>, message, current_version?, issues? }
  const raw = body as Record<string, unknown>;
  const wireCode = raw.code;            // D10 已消除：直接读 wire 字段 code（原 raw.error 适配已删除）
  const codeParse = errorCodeSchema.safeParse(wireCode);  // 用 contracts SSOT 校验
  const code: ErrorCode | 'INTERNAL_ERROR' = codeParse.success ? codeParse.data : 'INTERNAL_ERROR';
  return {
    code,
    message: typeof raw.message === 'string' ? raw.message : '操作失败',
    ...(typeof raw.current_version === 'number' ? { current_version: raw.current_version } : {}),
  };
}
```

**保留 safeParse + fallback（D7，非 D10 残留）**：`INTERNAL_ERROR`（500）/`NOT_FOUND`（通用 404）非 contracts `errorCodeSchema` 枚举，client safeParse 失败 → fallback `INTERNAL_ERROR`（前端本地码 `LocalErrorCode`）。不扩 `errorCodeSchema`（Q2 决策②，避免跨域 ①类隐式 impact）。`INTERNAL_ERROR` round-trip 正确（server 发 → client 收到一致），`NOT_FOUND` 降级 `INTERNAL_ERROR`（边缘场景行为不变）。

**保留手动读字段（不 `errorResponseSchema.parse(body)` 直校）**：因 D21 issues 仍存在（Q7 本轮不消除），`errorResponseSchema` 的 `.strict()` 会拒绝含 issues 的 body。故继续手动读 `raw.code` / `raw.message` / `raw.current_version`，issues 丢弃。D21 列为 future advisory（与 Q2 非 contracts 码同类，未来"contracts 完整化"轮处理）。

**对外契约**：API client 抛出的错误体类型为 `ApiError`（contracts `ErrorCode` 派生 + 前端本地 `LocalErrorCode` 兜底），前端业务代码（pages/components）只接触 contracts 类型（ARCH-003 类型来自 contracts）。`message` 与 `current_version` 字段名 wire 与 contracts 一致，无需重命名。

## 5. 状态管理

### 5.1 AuthContext + token 存储（D12 [约束]）

- `auth/tokenStore.ts`（leaf）：
  - `getToken(): { token: string; expires_at: string } | null` —— 读 localStorage key=`admin_token`
  - `setToken(result: LoginResult): void` —— 写 `{ token, expires_at }`
  - `clearToken(): void` —— 移除 key
  - 仅 localStorage，不写 sessionStorage/cookie（避免双重存储，PRD token 存储策略）
- `auth/AuthContext.tsx`：
  - state：`{ isAuthenticated: boolean, token: string | null }`（启动时从 tokenStore 读）
  - action `login(input: LoginInput)`：调 `api.auth.login` → 成功 `tokenStore.setToken` + setState + navigate /users
  - action `logout()`：调 `api.auth.logout`（Bearer 已注入）→ 成功 `tokenStore.clearToken` + setState + navigate /login
  - 不主动判定过期（依赖后端 401 TOKEN_EXPIRED 拦截，Q2 决策①）；expires_at 仅可选展示（MVP 可不展示）

### 5.2 路由守卫（D13 [约束]）

- `auth/RouteGuard.tsx`：包裹受保护路由的组件，读 AuthContext。
  - `!isAuthenticated && path !== '/login'` → `<Navigate to="/login" />`（AC-F6-1/3/4）
  - `isAuthenticated && path === '/login'` → `<Navigate to="/users" />`（AC-F1-7）
  - 白名单仅 `/login`（Q7 决策①），其余路由均须登录
- 登出：UserListPage 顶部"登出"按钮 → `AuthContext.logout()`（AC-F6-2）

### 5.3 列表页本地 state（无全局状态库）

`UserListPage` 用 `useState` 管理本地状态：`{ items: User[], total, page, pageSize, status?: UserStatus, loading, error }`。翻页/筛选改 state → useEffect 触发 `api.users.list`。无 Redux/Zustand（D5 零新依赖）。

## 6. 页面与组件设计（[advisory] 实现提示，impl-writer 落地）

> 本节为页面/组件行为契约，impl-writer 据此实现。样式用 CSS Modules / 内联样式（零 UI 框架，PRD F5）。

### 6.1 LoginPage（F1）

- 表单字段：email（input type=email）、password（input type=password）。
- 提交流程：`loginInputSchema.safeParse(form)` → 失败显示字段级错误（AC-F1-4/5/6，不发请求）→ 成功调 `AuthContext.login`。
- 成功：token 写入 localStorage + 跳 /users（AC-F1-1）。
- 失败（INVALID_CREDENTIALS）：显示"邮箱或密码错误"（AC-F1-2/3，不区分邮箱不存在，防枚举）。
- 已登录访问 /login：RouteGuard 跳 /users（AC-F1-7）。
- 提交中：按钮 disabled + loading 文案（AC-F1-8，D16）。
- password 提交后从组件 state 清除（D12 PII 安全）。

### 6.2 UserListPage（F2/F3/F4）

- 首次加载：`api.users.list({ page: 1, pageSize: 20 })`（D14，AC-F2-1）。
- 渲染：每行 `<UserRow>`（name/email/status + 启用/禁用按钮 + version 隐藏用于 If-Match）。
- 分页：页码按钮 → 改 page state → 重新 list（AC-F2-2）。
- 状态筛选：select status → 改 status state → page 重置 1 → list（AC-F2-3/4）。
- 空状态：items=[] 显示"暂无用户"（AC-F2-5）。
- 分页信息："共 X 条，第 Y/Z 页"（AC-F2-6）。
- 加载态：列表区域 loading 文案（AC-F2-7，D16）。
- 创建用户按钮 → 打开 `<CreateUserModal>`。
- 启停按钮：调 `api.users.updateStatus(id, { status }, { versioned: true, expectedVersion: user.version })`。
  - 成功：刷新列表（取最新 version，避免下次冲突）。
  - VERSION_CONFLICT：API client 自动重试（D9），重试成功刷新列表（AC-F4-3）；重试仍冲突显示"数据已被修改，请刷新后重试"（AC-F4-4）。
  - USER_DISABLE_SELF_FORBIDDEN：显示"不能禁用自身账号"（AC-F4-5，后端判，前端不预判——token 不透明无法解析 sub）。
  - USER_ALREADY_DISABLED/ACTIVE：显示"用户已是禁用/启用状态"（AC-F4-6）。
- 登出按钮：调 `AuthContext.logout()`（AC-F6-2）。

### 6.3 CreateUserModal（F3）

- 表单字段：email、name、password（可选，Q6 决策②）。
- 提交：`createUserInputSchema.safeParse(form)` → 失败字段级错误（AC-F3-3/4/6）→ 成功调 `api.users.create`。
  - password 空 → 请求体不含 password 字段（对齐 optional，AC-F3-5）。
  - password 填但 <8 → safeParse 拦截（AC-F3-6）。
- 成功：关闭弹窗 + 刷新列表含新用户（默认 active，AC-F3-1）。
- USER_EMAIL_DUPLICATE：表单内显示"邮箱已存在"（AC-F3-2）。
- 提交中按钮禁用 + loading（D16）。

### 6.4 路由守卫组件 RouteGuard

见 §5.2。包裹 `/users` 等受保护路由 element。

## 7. 路由设计（React Router v6）

```tsx
// App.tsx 路由表（createBrowserRouter 或 <Routes>）
<Routes>
  <Route path="/login" element={<LoginPage />} />           {/* public，RouteGuard 仍判定已登录跳转 */}
  <Route path="/users" element={<RouteGuard><UserListPage /></RouteGuard>} />
  <Route path="/" element={<Navigate to="/users" replace />} />
  <Route path="*" element={<Navigate to="/users" replace />} />
</Routes>
```

- 白名单仅 `/login`（Q7 决策①，D13）：未登录访问 `/users` → RouteGuard 跳 `/login`；未登录访问 `*` → 跳 `/users` → RouteGuard 跳 `/login`。
- 已登录访问 `/login` → RouteGuard 逻辑放 LoginPage 内或独立判定 → 跳 `/users`（AC-F1-7）。
- react-router-dom v6（D5 零新依赖精神，路由库为必要第三方）。

## 8. ARCH-003 校验方案（check-rules.mjs 新增分支 + 扫描算法）

> 本节为 check-rules.mjs ARCH-003 分支的校验逻辑设计 + layering.md 校验方式更新指引。**实际脚本与规则文档改动由 impl-writer 落地**（D18 [约束]）。

### 8.1 校验目标

扫描 `apps/web/src/**/*.{ts,tsx}` 的 import 语句，禁止 import `apps/api/src/**`（repository/service/domain/router/server）与 `@admin/api` 包，仅允许 `@admin/contracts`（+ 第三方依赖 + apps/web 内部相对模块）。落地后 ARCH-003 从 `[预留]` 升级为机器化 enforcement（AC-ARCH-1/3）。

### 8.2 扫描算法（正则，对齐既有脚本风格）

既有 `walk(dir)` 仅收集 `.ts`，须新增 `walkWeb` 收集 `.ts` + `.tsx`：

```js
// ============ ARCH-003：前端禁止 import 后端模块 ============
markEnforcement('ARCH-003');
function walkWeb(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkWeb(p, acc);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) acc.push(p);  // 扩展 .tsx
  }
  return acc;
}
const webSrc = walkWeb(join(ROOT, 'apps/web/src'));
// 提取 import/export ... from 'spec' 与 side-effect import 'spec'
const IMPORT_SPEC_RE = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
// 禁止 specifier：@admin/api 包 / 含 api/src/ 子串 / 以 apps/api 开头
//   - api/src/ 子串覆盖绝对 'apps/api/src/...' 与相对逃逸 '../api/src/...'、'../../apps/api/src/...'
//   - contracts 导出 './schemas/*'，第三方包路径不含 'api/src/'，故子串判定无误伤
const ARCH003_FORBIDDEN_RE = /(?:^@admin\/api\b)|(?:api\/src\/)|(?:^apps\/api\b)/;
for (const f of webSrc) {
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = IMPORT_SPEC_RE.exec(src)) !== null) {
    const spec = m[1] || m[2];
    if (ARCH003_FORBIDDEN_RE.test(spec)) {
      errors.push(`ARCH-003 违规：${rel(f)} import 了后端模块 "${spec}"（前端只能经 @admin/contracts 调用后端，禁止直连 apps/api/src/** 或 @admin/api）`);
    }
  }
}
```

### 8.3 算法要点

1. **范围**：仅扫 `apps/web/src/`（不含 apps/web/test，测试文件可 import 测试工具；但测试亦不应 import apps/api/src，可由 Reviewer 人工 + 同算法可选扩展覆盖）。
2. **文件类型**：`.ts` + `.tsx`（既有 walk 仅 `.ts`，须扩展）。
3. **specifier 提取**：正则覆盖 `import ... from 'x'`、`export ... from 'x'`、`import 'x'`（side-effect）。
4. **禁止规则**（三条，任一命中即违规）：
   - `^@admin/api\b` —— import @admin/api 包（跨层直连后端包）
   - `api/src/` 子串 —— 覆盖绝对 `apps/api/src/...` 与相对逃逸 `../api/src/...`、`../../apps/api/src/...`
   - `^apps\/api\b` —— 以 `apps/api` 开头的绝对路径
5. **允许**：`@admin/contracts`、`@admin/contracts/*`、`react`、`react-router-dom`、`react-dom`、apps/web 内相对模块（`./`、`../` 不逃逸到 apps/api）、node 内置。
6. **META 双向绑定**：`markEnforcement('ARCH-003')` + layering.md ARCH-003 校验方式更新为含 `check-rules.mjs ARCH-003 分支` 措辞 → 满足 META-003（声明即实现）+ META-004（实现即声明，规则文档已存在 ARCH-003 heading）。

### 8.4 layering.md 校验方式更新（impl-writer 落地，D18 [约束]）

将 `.trae/rules/architecture/layering.md` ARCH-003 校验方式从：

> `[预留] 本 MVP 暂无 apps/web，待 web 引入后在 scripts/check-rules.mjs 新增对应校验...当前由 ci 整体脚本 + 人工 Review 保障，无专属 enforcement（不触发 META-003）。`

更新为：

> `scripts/check-rules.mjs` ARCH-003 分支扫描 `apps/web/src/**/*.{ts,tsx}` 的 import 语句，禁止 import `apps/api/src/**`（repository/service/domain/router/server）与 `@admin/api` 包，仅允许 `@admin/contracts` + 第三方依赖 + apps/web 内部模块；违规即报错 exit≠0。`

更新后该校验方式段含 `check-rules.mjs` + `ARCH-003` + `分支`，命中 META-003 `claimsExclusive` 正则 → 双向绑定闭合。同时移除"不触发 META-003"措辞（因已触发）。

### 8.5 AST 替代方案（[advisory]，未来增强）

正则方案对齐既有脚本风格（ARCH-001/002/CODE-* 均正则），MVP 足够。未来若需更精确（如动态 import、字符串拼接路径），可改用 esbuild/swc 解析为 AST 后遍历 ImportDeclaration。本期不引入（零新依赖精神），记 §10 advisory。

## 9. 受影响测试清单（AI-006 两类标注）

> 本轮为**全新前端**（apps/web 此前不存在），既有后端/契约测试零改动。严格遵守 AI-006：①类分显式+隐式两个子类 + ②类签名变更 + ③类新增。

### 9.1 ① 类：contracts 联动驱动

**①-A 显式影响（grep 符号引用）—— 0 文件：**

grep 命令：`rg "apps/web|@admin/web" apps/api/test/ packages/*/test/`。判定依据：apps/web 目录本轮才创建，既有测试（18 个 apps/api/test 文件 + packages 测试）不可能引用不存在的 apps/web 模块。**零命中 → 零显式影响。**

**①-B 隐式影响（全集断言依赖枚举值，R11 S-2）—— 0 文件：**

既有 SSOT 派生断言（`[...errorCodeSchema.options]` containment）位于 `notification.test.ts` / `report.test.ts` / `role-inheritance.test.ts` / `optimistic-locking.test.ts`（详见 TECH-AUTH-001 §9 ①类清单）。判定依据：**本轮契约层零新增**（PRD 明示 contracts 已就绪，errorCodeSchema 不扩展、errorResponseSchema 不变），枚举值不变 → 既有 containment 断言不失效。**零隐式影响。**

①类小结：**0 文件受影响**（显式 0 + 隐式 0）。根因：契约冻结 + apps/web 全新。

### 9.2 ② 类：既有签名/行为变更驱动 —— 0 文件

判定依据：本轮后端冻结（不改 service/repo/domain/router/server.ts/contracts），后端 API 签名与 wire 格式零变更；前端是新增消费者，不改变既有后端行为。**②类零影响。**

> 与 PRD 估算对齐：PRD 未声称 ②类影响（本轮纯前端新增），本 Spec 精确分析确认 ②类 = 0。

### 9.3 ③ 类：新增测试（6 文件，impl-writer/test-writer 阶段）

| # | 文件 | 类型 | 覆盖 AC |
|---|------|------|---------|
| 1 | `apps/web/test/api-client.test.ts` | API client 单测（mock fetch） | AC-F5-1/2/3/4/5、AC-F7-1/3、AC-F4-3/4/7、AC-ARCH-2 |
| 2 | `apps/web/test/error-mapping.test.ts` | 错误映射单测（SSOT 派生） | AC-F7-2、AC-ARCH-4 |
| 3 | `apps/web/test/login-page.test.tsx` | 组件测（Testing Library） | AC-F1-1~F1-8 |
| 4 | `apps/web/test/user-list-page.test.tsx` | 组件测 | AC-F2-1~F2-7、AC-F4-1/2/5/6 |
| 5 | `apps/web/test/create-user-modal.test.tsx` | 组件测 | AC-F3-1~F3-6 |
| 6 | `apps/web/test/route-guard.test.tsx` | 守卫测 | AC-F6-1~F6-4、AC-F1-7 |

各文件断言要点：
- **api-client.test.ts**（mock global.fetch）：Bearer 注入（AC-F5-2）、If-Match 注入（AC-F5-3）、401 拦截 4 鉴权码跳登录（AC-F7-1）、INVALID_CREDENTIALS 不拦截原样抛（Q2）、VERSION_CONFLICT 用 current_version 重试 1 次（AC-F4-3）、重试仍 409 抛错（AC-F4-4）、错误体读 raw.code（D10 已消除 R18）、网络错误兜底（AC-F7-3）、类型全部 contracts 派生无手写副本（AC-ARCH-2，tsc 保证）。
- **error-mapping.test.ts**：映射表键 = `[...errorCodeSchema.options]`（SSOT 派生，AI-005）；各码中文提示；未映射码通用提示（AC-F7-2）。
- **login-page.test.tsx**：表单校验（email/密码长度/空）、提交成功跳 /users、INVALID_CREDENTIALS 提示、loading+按钮禁用、已登录跳转（AC-F1-1~8）。
- **user-list-page.test.tsx**：列表渲染、分页、状态筛选、空状态、加载态、启停成功、禁用自身提示、重复状态提示（AC-F2-1~7、F4-1/2/5/6）。
- **create-user-modal.test.tsx**：校验、创建成功、邮箱重复、password 可选/长度（AC-F3-1~6）。
- **route-guard.test.tsx**：未登录跳 /login、登出后不可访问、白名单仅 /login、已登录访问 /login 跳 /users（AC-F6-1~4、F1-7）。

③类小结：6 新增测试文件，覆盖 PRD 48 条 AC + ARCH-003 合规专项。无 E2E（Q8 决策②）。

## 10. 决策清单（D1~D21）

> 每个决策显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程 + Reviewer 确认）或 `[advisory]`（允许偏离，须反向同步 Spec §10）。

### D1 · 前端分层结构与依赖方向 `[约束]`
apps/web/src 分层 `api/`、`pages/`、`components/`、`auth/`、`lib/`，职责与依赖方向见 §2.2。`tokenStore`/`lib/` 为叶子层；`api/client` 读 token 经 `tokenStore`（非 AuthContext）避免循环。impl-writer 偏离分层须反向同步。

### D2 · ARCH-003 跨层只经契约（前端 import 限制）`[约束]`
apps/web/src 全部模块只能 import `@admin/contracts`（+ `@admin/contracts/*`）+ 第三方依赖（react/react-router-dom/react-dom）+ apps/web 内部相对模块；**禁止 import `apps/api/src/**`（repository/service/domain/router/server）与 `@admin/api` 包**。机器化校验见 §8（AC-ARCH-1）。违规即 blocker。

### D3 · 类型 z.infer 派生 + 禁用存储实体类型 `[约束]`
全部数据类型经 `z.infer` 从 `@admin/contracts` 派生（§3.1），**禁止手写 TS 类型副本**（ARCH-002/CODE-004 延伸，AC-F5-4/AC-ARCH-2）。前端**禁止 import** `userEntitySchema`/`UserEntity`（含 password_hash，后端内部，SEC-003a）与 `tokenPayloadSchema`/`TokenPayload`（验签内部，token 对前端不透明）。

### D4 · 客户端表单校验复用 contracts Zod schema `[约束]`
登录/创建/状态更新表单复用 `loginInputSchema`/`createUserInputSchema`/`updateUserStatusInputSchema` 的 `.safeParse()`（§3.2），**禁止手写校验正则副本**（AI-005 SSOT，AC-ARCH-4）。保证前后端校验规则同源。

### D5 · API client 原生 fetch，零新 HTTP 依赖 `[约束]`
HTTP 用原生 `fetch` + `URLSearchParams`，**禁止引入 axios/ky 等库**（PRD F5 零新依赖精神，AC-F5-5）。路由用 react-router-dom（必要第三方），状态用 React Context + 本地 state（无 Redux/Zustand）。

### D6 · Bearer token 自动注入 `[约束]`
除 login（`skipAuth=true`）外，所有请求从 `tokenStore.getToken()` 读 token 注入 `Authorization: Bearer <token>`（AC-F5-2）。无 token 时仍发请求（受保护路由后端返 401 → 拦截）。

### D7 · If-Match 自动注入（versioned 写）`[约束]`
`versioned=true` 且调用方传 `expectedVersion`（= user.version）时，client 注入 `If-Match: <expectedVersion>`（AC-F5-3/AC-F4-7）。PATCH status 须 versioned。API client 保证注入，前端不应触发 VERSION_REQUIRED。

### D8 · 401 拦截（区分鉴权类与凭据错）`[约束]`
401 响应经解析取 code（D10 已消除，直接读 raw.code）：`code ∈ {UNAUTHORIZED, TOKEN_INVALID, TOKEN_EXPIRED, TOKEN_REVOKED}` → 清 token + 跳 /login（AC-F7-1，Q2 决策①）；`code === INVALID_CREDENTIALS` → 原样抛登录页（login 业务错误，不跳转、不清 token）。判定顺序：先解析错误体取 code，再按 code 分支。

### D9 · VERSION_CONFLICT 重试（用 409 body current_version，409-retry 设计选择）`[约束]`（R18 重分类，原 [advisory]-adjacent）
409 VERSION_CONFLICT 时，从响应体读 `current_version`，用新 version 重试原 PATCH 1 次（Q3 决策②，AC-F4-3）；重试仍 409 → 抛错提示"数据已被修改，请刷新后重试"（AC-F4-4）。重试仅 1 次防活锁。重试仅对 PATCH status（幂等可接受）。**R18 重分类**（TECH-USER-DETAIL-WIRE-001 D3）：原 D9 因 `GET /v1/users/:id` 端点缺失而改用 409 body 重试，记为 [advisory]-adjacent；R18 端点 gap 闭合后（§1.2，D19 已消除），D9 重分类为正式 `[约束]` 设计决策——client 选择 409-retry 而非 GET-retry（Q6 决策①：409-retry 无额外 round trip + 已测试工作 + GET-retry 须处理 GET 也 409 边缘场景，复杂度更高）。重试链不切换为 GET-retry，但 `GET /v1/users/:id` 端点存在为 future 用户详情页消费 + GET-retry 可选项提供基础。

### D10 · wire 字段名对齐 error→code `[advisory]`（R18 已消除，历史记录）
contracts `errorResponseSchema` 字段名 `code`，server.ts L594 wire 字段名 `error`（R12 历史遗留不一致）。R12 API client 解析层读 wire `error` → `errorCodeSchema` 校验 → 映射为 contracts `code`，对外暴露 `ApiError` 类型（§4.6），前端业务代码不感知差异（ARCH-003）。`message`/`current_version` 字段名一致无需重命名。**R18 已消除**（TECH-USER-DETAIL-WIRE-001 D1，Q1 接受 breaking change）：server.ts 全部 7 处错误响应 `error` → `code`，client `parseErrorResponse` 删除 wire 适配层直接读 `raw.code`。保留 `errorCodeSchema.safeParse + fallback INTERNAL_ERROR`（D7，非 contracts 码降级，与 D10 wire 适配独立，未消除）；保留手动读字段（D21 issues 仍存在，Q7 本轮不消除，不 `errorResponseSchema.parse(body)` 直校）。

### D11 · ErrorCode→中文映射 SSOT 派生 `[约束]`
`lib/errorMapping.ts` 维护 `Record<ErrorCode, string>` 映射表，键从 `[...errorCodeSchema.options]` SSOT 派生（AI-005，AC-F7-2）。未映射码显示通用"操作失败，请稍后重试"。禁止硬编码全集（须 SSOT 派生，枚举扩展时不漏）。

### D12 · token 存储 + PII 安全 `[约束]`
- token 存 localStorage key=`admin_token`，值 `{ token, expires_at }`（Q1 决策①，AC-F1-1）。登出/401 拦截清除。不写 sessionStorage/cookie。
- `password`：仅存登录/创建表单内存，**禁止持久化到任何存储**；**禁止 console.log/记录到错误日志/错误响应**（SEC-003b 延伸，AC-F7-4）；提交后从 state 清除。
- `token`：**禁止 console.log/记录**（AC-F7-5）。
- `password_hash`：前端永不存在（userSchema 不含，D3 禁 userEntitySchema）。

### D13 · 路由守卫白名单仅 /login `[约束]`
白名单仅 `/login`（Q7 决策①）。未登录访问受保护页 → 跳 /login（AC-F6-1/3/4）；已登录访问 /login → 跳 /users（AC-F1-7）；登出跳 /login（AC-F6-2）。

### D14 · 列表 pageSize 默认 20 `[约束]`
列表页默认 `pageSize=20`（Q5 决策②，AC-F2-1）。**不依赖 `listUserQuerySchema` 缺省**（schema default=10），前端显式传 pageSize=20。schema max(100) 仍约束上限。

### D15 · 不启用协商缓存 `[约束]`
前端不发送 `If-None-Match`，始终接受 200 全量响应（Q12 决策①）。后端 ETag 支持保留，未来可启用不破坏契约。304 不会触发。

### D16 · 加载态 loading 文案 + 按钮禁用 `[约束]`
加载态用简单 loading 文案 + 提交按钮 disabled（Q10 决策①，AC-F1-8/AC-F2-7）。不做骨架屏（零 UI 框架）。

### D17 · 测试栈 Vitest + Testing Library + jsdom，无 E2E `[约束]`
测试用 Vitest + @testing-library/react + @testing-library/jest-dom + jsdom（Q8 决策②，AC-F5-5）。无 E2E（Playwright）。web 组件测须 jsdom 环境（根 vitest.config `environment=node`，web `.tsx` 测试须 per-file `// @vitest-environment jsdom` 注解，D20 [advisory]）。

### D18 · ARCH-003 校验脚本落地 + layering.md 更新 `[约束]`
impl-writer 须：(1) 在 `scripts/check-rules.mjs` 新增 ARCH-003 分支（§8.2 算法，含 walkWeb 扩展 .tsx）；(2) 更新 `.trae/rules/architecture/layering.md` ARCH-003 校验方式从 `[预留]` 为 §8.4 机器化描述（闭合 META-003/META-004 双向绑定）。落地后 ARCH-003 从人工 Review 升级为机器化 enforcement（AC-ARCH-3）。

### D19 · PRD AC-F4-3 "GET 最新 user" 措辞偏离 `[advisory]`（R18 已消除，历史记录）
PRD AC-F4-3 字面"GET 最新 user 取 version"无法落地（R12 核验 `GET /v1/users/:id` 端点不存在，§1.2）。R12 Spec 改用 409 响应体 `current_version` 重试（D9）。语义不弱化（重试仍 1 次、仍用最新 version）。impl-writer 据此落地，test-writer 据此设计冲突重试用例（断言重试请求的 If-Match = 409 body current_version，而非发 GET）。**R18 已消除**（TECH-USER-DETAIL-WIRE-001 D2）：`GET /v1/users/:id` 端点已补齐（admin + user:read + cacheable + detailEtag），D19 [advisory] 标注移除（端点 gap 闭合）。D9 重分类为 `[约束]`（D9 重分类决策，client 选择 409-retry 而非 GET-retry，Q6 决策①）。前端 future 轮次可消费 `getUser(id)`（AC-G13 future-ready）。

### D20 · jsdom 环境配置方式 `[advisory]`
根 vitest.config.ts `environment=node` 且 `include` 仅 `*.test.ts`（不匹配 `.tsx`）。impl-writer 须：(1) 扩展 include 为 `apps/*/test/**/*.{test,spec}.{ts,tsx}`；(2) web `.tsx` 测试用 per-file `// @vitest-environment jsdom` 注解（推荐，最小侵入）。[advisory] 替代：独立 `vitest.config.web.ts`（projects 模式分离 node/jsdom），impl-writer 可选须反向同步。jsdom 须加入 apps/web devDependencies。

### D21 · VALIDATION_ERROR 响应额外 issues 字段 `[advisory]`
server.ts L562-566 VALIDATION_ERROR 响应带额外 `issues` 字段（contracts `errorResponseSchema` 未声明）。API client 不 `errorResponseSchema.parse(body)` 直校（会被 `.strict()` 拒绝），改为手动读 `code`/`message`/`current_version` 构造 ErrorResponse（§4.6，D10 已消除，wire 字段名为 code），`issues` 丢弃。[advisory]：R18 已对齐 wire 字段名（D10 已消除），但 issues 仍存在（Q7 不本轮消除）。若未来移除 `issues`（或 contracts 声明 issues），可改 `errorResponseSchema.parse(body)` 直校。

### 多 [约束] 组合副作用预判

> 提前标注多约束组合的潜在副作用，impl-writer 实现时须规避，偏离按 AI-003 反向同步。

1. **「401 拦截（D8）+ VERSION_CONFLICT 重试（D9）」组合**：重试的 PATCH 请求可能返回 401（token 在重试间隙过期/吊销）。判定顺序须**先判 401（拦截跳登录）再判 409（重试）**——即重试响应若为 401，走 D8 拦截终止重试链，不把 401 误当冲突。否则会把鉴权失败误重试。无活锁（401 终止重试）。impl-writer 须保证响应处理顺序：status===401 分支先于 status===409 分支。
2. **「错误体解析（D10 已消除）+ 401 拦截（D8）」组合**：401 响应体字段名为 `code`（R18 已对齐，D10 已消除），解析取 code 后判是否拦截。须保证 401 响应体解析失败（非 JSON/缺 code 字段）时降级为 INTERNAL_ERROR → 仍按 UNAUTHORIZED 行为跳登录（不抛异常致白屏）。R18 后字段名一致，无适配层冲突。
3. **「乐观锁重试（D9）+ 列表刷新」组合**：重试成功后列表须刷新取最新 version（UserListPage 重新 list），否则下次对同一用户操作又会用旧 version 触发 409。impl-writer 须保证启停成功（含重试成功）后触发 list 刷新。
4. **「tokenStore（D12）+ 401 拦截（D8）」组合**：401 拦截清 token 后，若有并发请求在飞（如列表+筛选同时发），另一请求也可能 401 重复跳 /login。MVP 接受重复跳转（幂等）；impl-writer 可加"已跳转"标志位防重复，[advisory] 不强制。

## 11. 边界与异常（错误码 → 用户提示 + 交互行为矩阵）

> 对齐 contracts `errorCodeSchema` SSOT。前端可能遇到的码全集 + 网络兜底。映射表键 SSOT 派生（D11）。

| ErrorCode | 触发场景 | 用户提示 | 交互行为 | AC |
|-----------|----------|----------|----------|----|
| `VALIDATION_ERROR` | 客户端 schema 拦截（不到后端）；或后端 safeParse 失败 | 字段级错误（"邮箱格式不正确"/"密码至少 8 位"等） | 不发请求；若到后端则显示 message | AC-F1-4/5/6、AC-F3-3/4/6 |
| `UNAUTHORIZED` | 受保护路由缺失/无效 token | （不提示，直接跳登录） | 清 token + 跳 /login | AC-F7-1、AC-F6-1 |
| `FORBIDDEN` | role ≠ admin 访问 admin 路由 | "无权限执行此操作" | 原样显示 | — |
| `USER_NOT_FOUND` | PATCH status 目标 id 不存在 | "用户不存在" | 刷新列表 | — |
| `USER_EMAIL_DUPLICATE` | 创建用户邮箱已占用 | "邮箱已存在" | 创建表单内显示 | AC-F3-2 |
| `USER_DISABLE_SELF_FORBIDDEN` | 禁用自身（后端判，token 不透明前端不预判） | "不能禁用自身账号" | 原样显示 | AC-F4-5 |
| `USER_ALREADY_DISABLED` | 对已 disabled 用户点禁用 | "用户已是禁用状态" | 原样显示 | AC-F4-6 |
| `USER_ALREADY_ACTIVE` | 对已 active 用户点启用 | "用户已是启用状态" | 原样显示 | AC-F4-6 |
| `INVALID_CREDENTIALS` | 登录邮箱不存在/密码错（模糊） | "邮箱或密码错误" | 登录页显示，**不拦截**、不清 token | AC-F1-2/3 |
| `TOKEN_INVALID` | token 伪造/格式错/scheme 非 Bearer | （不提示，跳登录） | 清 token + 跳 /login | AC-F7-1 |
| `TOKEN_EXPIRED` | token 已过期 | （不提示，跳登录） | 清 token + 跳 /login | AC-F7-1 |
| `TOKEN_REVOKED` | token 已登出吊销 | （不提示，跳登录） | 清 token + 跳 /login | AC-F7-1、AC-F6-5 |
| `VERSION_REQUIRED` | PATCH 缺 If-Match | "操作失败，请稍后重试" | **不应触发**（API client 保证注入，AC-F4-7）；触发则说明 client bug | AC-F4-7 |
| `VERSION_CONFLICT` | If-Match version 不匹配 | （自动重试无提示）；重试仍冲突 → "数据已被修改，请刷新后重试" | 用 current_version 重试 1 次；仍冲突抛错 | AC-F4-3/4 |
| 其余未映射码 | 后端其他域错误码（ROLE_*/DEPT_*/NOTIFICATION_* 等，本轮不触发） | "操作失败，请稍后重试" | 原样显示 | AC-F7-2 |
| （非 contracts）`NETWORK_ERROR` | fetch 抛错（网络断开/服务不可达） | "网络异常，请稍后重试" | 不白屏 | AC-F7-3 |
| （非 contracts）`INTERNAL_ERROR` / 5xx | 后端 500 INTERNAL_ERROR | "服务异常，请稍后重试" | 原样显示 | AC-F7-2 |

补充：
- 禁用自身判定（AC-F4-5）：token 为不透明 HMAC 字符串，前端不解析 payload（无法获知 sub）。故**前端不预判**禁用自身，依赖后端返回 `USER_DISABLE_SELF_FORBIDDEN` 显示提示。不隐藏"禁用"按钮（无 /me 端点获知当前用户 id）。
- password/token 不入日志（AC-F7-4/5，D12）：错误上报/控制台日志须脱敏，不输出 password/token 字符串。

## 12. 工程配置（apps/web 融入 monorepo）

### 12.1 apps/web/package.json（D5/D17 依赖清单）

```json
{
  "name": "@admin/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@admin/contracts": "*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- `@admin/contracts: "*"` —— workspace 依赖（pnpm/npm workspaces 解析，根 package.json `workspaces: [packages/*, apps/*]` 已覆盖 apps/web）。
- 无 axios/ky（D5）；无 Redux/Zustan；无 UI 框架（PRD F5）。
- 版本号对齐根 devDependencies（vitest ^1.6.0、typescript ^5.4.0）。

### 12.2 vite.config.ts

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@admin/contracts': '/packages/contracts/src/index.ts' } },
  server: { proxy: { '/v1': 'http://localhost:3000' } },  // dev 便捷：前端 /v1 代理到后端
});
```

- alias `@admin/contracts` 对齐根 tsconfig paths（运行时解析）。
- dev proxy `/v1` → 后端 3000，避免 CORS（[advisory]：生产用 `VITE_API_BASE_URL` 直连，须后端 CORS 配置，本轮不改后端）。

### 12.3 tsconfig

- `apps/web/tsconfig.json` 继承根 tsconfig（`extends`），追加 `"jsx": "react-jsx"`、`"lib": ["DOM", "DOM.Iterable", "ES2022"]`、`"types": ["vitest/globals", "node"]`。
- 根 tsconfig `include` 已含 `apps/*/src`、`apps/*/test`，apps/web 自动纳入根 `typecheck`（`tsc -p tsconfig.json --noEmit`）。
- [advisory]：根 tsconfig 无 `jsx` 设置，apps/web `.tsx` 须 jsx 配置。推荐根 tsconfig 追加 `"jsx": "react-jsx"`（对 apps/api 无 tsx 文件无害），或 apps/web 独立 tsconfig + 独立 typecheck 脚本（impl-writer 选，须反向同步）。本 Spec 推荐前者（最小改动）。

### 12.4 vitest 配置（D17/D20）

- 根 `vitest.config.ts`：`environment: 'node'`、`include: ['apps/*/test/**/*.test.ts', ...]`。
- 本轮须调整（impl-writer 落地）：
  1. 扩展 `include` 为 `['apps/*/test/**/*.{test,spec}.{ts,tsx}', 'packages/*/test/**/*.test.ts']`（匹配 .tsx）。
  2. web `.tsx` 测试文件首行加 `// @vitest-environment jsdom` 注解（per-file 环境，D20 推荐方案）。
  3. `@testing-library/jest-dom` matchers 经 `apps/web/test/setup.ts`（`import '@testing-library/jest-dom'`）注入，vitest config `setupFiles: ['apps/web/test/setup.ts']`。
- coverage `include` 当前 `apps/*/src/**/*.ts`（不匹配 .tsx）；[advisory] 扩展为 `apps/*/src/**/*.{ts,tsx}` 若需 web 覆盖率，MVP 可不强制 web 覆盖率门槛。

### 12.5 monorepo 融入

- apps/web 作为 workspace 包接入（根 `workspaces: [packages/*, apps/*]` 已覆盖，无需改根 package.json）。
- `@admin/contracts` 经 workspace 解析（`@admin/contracts: "*"`）。
- 根 scripts `test`（`vitest run`）+ `lint:rules`（`node scripts/check-rules.mjs`）+ `typecheck`（`tsc -p tsconfig.json --noEmit`）自动覆盖 apps/web（三件套对前端生效，AI-004）。
- ARCH-003 校验（§8）经 `lint:rules` 执行，前端源码 import 违规即 exit≠0。
