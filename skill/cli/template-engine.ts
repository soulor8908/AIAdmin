// cli/template-engine.ts —— 模板渲染引擎（调度逻辑）
// P1-1 / P1-3 产出：根据 GenerateOptions 渲染完整项目骨架。
//
// 问题 5 修复：本文件只保留渲染调度 + 冲突检测 + 占位符残留校验。
// 各部分模板已拆分到 cli/templates/ 下：
// - templates/shared.ts        共享工具（normalizePkgName / loadAdapterFileOrThrow / 等）
// - templates/root-files.ts   项目根文件 + .ai-spec/ + contracts + docs
// - templates/api-scaffold.ts apps/api 骨架（TS/FastAPI/Spring Boot）
// - templates/web-scaffold.ts  apps/web 骨架（React + Vite）
// - templates/scripts.ts      scripts/ + .github/workflows/ + test setup

import type { GenerateOptions } from './options.js';
import type { WriteOp } from '../spi/adapter.js';
import { renderRootFiles, renderAiSpec, renderContracts, renderDocs } from './templates/root-files.js';
import { renderAppsApi } from './templates/api-scaffold.js';
import { renderAppsWeb } from './templates/web-scaffold.js';
import { renderScripts, renderCi, renderTestSetup } from './templates/scripts.js';

export interface RenderResult {
  writes: WriteOp[];
  warnings: string[];
}

export async function renderProject(opts: GenerateOptions): Promise<RenderResult> {
  const writes: WriteOp[] = [];
  const warnings: string[] = [];

  // 1. 项目根文件
  writes.push(...renderRootFiles(opts));

  // 2. .ai-spec/ 目录（从 kernel/ 拷贝规则 + 角色 + 模板）
  writes.push(...renderAiSpec(opts));

  // 3. packages/contracts/（按 contract 库渲染）
  writes.push(...renderContracts(opts));

  // 4. apps/api/（按 backend 渲染）
  writes.push(...renderAppsApi(opts, warnings));

  // 5. apps/web/（按 frontend 渲染）
  if (opts.stack.frontend !== 'none') {
    writes.push(...renderAppsWeb(opts, warnings));
  }

  // 6. scripts/（工具脚本）
  writes.push(...renderScripts(opts));

  // 7. .github/workflows/（按 ci 渲染）
  if (opts.stack.ci !== 'none') {
    writes.push(...renderCi(opts, warnings));
  }

  // 8. docs/（PRD/Tech-Spec/Review/Retro 目录占位）
  writes.push(...renderDocs(opts));

  // 9. 测试（P1-4 阶段保证零业务代码时三件套全绿）
  writes.push(...renderTestSetup(opts));

  // P1-3 冲突检测：同路径多次写入即冲突
  const pathSeen = new Map<string, number>();
  for (const w of writes) {
    pathSeen.set(w.path, (pathSeen.get(w.path) ?? 0) + 1);
  }
  for (const [path, count] of pathSeen) {
    if (count > 1) {
      warnings.push(`路径冲突：${path} 被写入 ${count} 次（仅保留最后一次）`);
    }
  }
  // 去重：保留最后一次写入（后写优先策略，便于适配器覆盖）
  const deduped = new Map<string, WriteOp>();
  for (const w of writes) {
    deduped.set(w.path, w);
  }
  const finalWrites = [...deduped.values()];

  // 建议 4：渲染后占位符残留检测
  // 检查"生成代码"是否含未替换 {{...}} 占位符
  // 注意：.ai-spec/ 下是 kernel 拷贝的模板/角色提示词，本就是模板格式（含 {{var}}），不检测
  // .tmpl / .hbs 文件是适配器模板源文件，也不检测
  for (const w of finalWrites) {
    if (w.path.startsWith('.ai-spec/')) continue;
    if (w.path.endsWith('.hbs')) continue;
    if (w.path.endsWith('.tmpl')) continue;
    const leftover = w.content.match(/\{\{[a-zA-Z_-]+\}\}/g);
    if (leftover) {
      warnings.push(
        `文件 ${w.path} 含未替换占位符：${[...new Set(leftover)].join(', ')}（建议 4：渲染后验证）`,
      );
    }
  }

  return { writes: finalWrites, warnings };
}
