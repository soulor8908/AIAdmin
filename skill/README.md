# AI Spec Skill —— 共享内核 + 适配器

> Phase 0 产出：把 `mvp/` 实验期资产从 Node.js/React/SQLite 绑定中解耦，形成技术栈无关的共享内核 + 可插拔适配器。
>
> 路线图：[mvp/docs/workflow/skill-product-roadmap.md](../mvp/docs/workflow/skill-product-roadmap.md)

## 目录结构

```
skill/
├── kernel/              # 共享内核（技术栈无关）
│   ├── rules/           # P0-1 声明式规则集 (YAML)
│   ├── schema/          # 规则元模型 JSON Schema
│   ├── roles/           # P0-5 五角色提示词 (参数化模板)
│   └── templates/       # P0-6 文档模板 (PRD/Tech-Spec/Review/Retro)
├── adapters/            # P0-2/P0-3 可插拔适配器
│   ├── contract/        # 契约渲染器 (Zod/Pydantic/JSON Schema)
│   └── architecture/    # 架构模板 (Fastify/Express/Spring Boot/FastAPI)
├── engine/              # P0-4 规则引擎 (核心 + plugin)
│   ├── src/
│   │   ├── engine.ts    # 核心：读声明式规则 + 跑 plugin 检查
│   │   ├── loader.ts    # YAML/JSON 规则加载
│   │   ├── plugins/     # 语言特化 plugin (TS/Java/Python)
│   │   └── reporter.ts  # 输出格式化
│   └── test/
├── tools/               # P0-7 通用 CLI 工具
│   ├── gen-delta.ts     # 增量上下文生成
│   └── gen-snapshot.ts  # 全量快照生成
├── spi/                 # P0-8 适配器 SPI 定义
│   ├── adapter.ts       # TypeScript 接口契约
│   └── README.md        # SPI 文档
└── test/                # DoD 验证套件
    ├── kernel-no-node-keyword.test.ts
    ├── adapter-render.test.ts
    ├── plugin-loadable.test.ts
    └── parity-13-enforcements.test.ts
```

## 设计原则

1. **内核只描述"做什么 + 为什么"，不绑定"用什么语言写"**
2. **适配器只描述"用 X 技术栈怎么落地"，可被替换**
3. **改造型与生成型共享内核与适配器，差异仅在入口流程**

## 当前状态

Phase 0 MVP 完成，DoD 四项全部通过：

- [x] 共享内核规则集无 Node.js 关键字（grep 不到 `require` / `node:` / `.mjs`）
- [x] 至少 2 种技术栈适配器（Zod + JSON Schema + Pydantic）能渲染出可编译的最小契约
- [x] 规则引擎在不修改核心的前提下，能加载一个外部 plugin
- [x] 实验期 13 项 enforcement 在新引擎下产出等价 verdict

## 用法（开发期）

```bash
cd skill
npm install
npm test                    # 跑 DoD 验证套件
npm run engine:parity       # 对 mvp/ 跑等价性测试
```
