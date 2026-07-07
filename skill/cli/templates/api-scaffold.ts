// cli/templates/api-scaffold.ts —— apps/api 骨架
// 问题 5：从 template-engine.ts 拆出。
//
// 包含：
// - TS Fastify/Express：server.ts 从适配器加载 + errors.ts 骨架 + package.json
// - FastAPI：从适配器加载 main.py + requirements.txt（兜底内联骨架）
// - Spring Boot：从适配器加载 Application.java / HealthController.java / pom.xml
// - experimental 防护：未知 backend 显式 warning 而非静默

import type { GenerateOptions } from '../options.js';
import type { WriteOp } from '../../spi/adapter.js';
import {
  loadAdapterFileOrThrow,
  adapterFileExists,
  renderAdapterTemplate,
} from './shared.js';

// ============ 内联模板字符串（兜底骨架） ============

const TS_ERRORS_TS = `// apps/api/src/errors.ts —— 错误码 SSOT（P1-1 骨架）
// 新增错误码时此文件须同步更新（AI-005 SSOT 派生约束）。

export const errorCodeToHttpStatus: Record<string, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};
`;

const PY_MAIN = `# app/main.py —— FastAPI 入口（P1-1 骨架）
from fastapi import FastAPI

app = FastAPI(title="AI Spec Project")


@app.get("/health")
async def health():
    return {"status": "ok"}
`;

// ============ apps/api 渲染 ============

export function renderAppsApi(opts: GenerateOptions, warnings: string[]): WriteOp[] {
  const writes: WriteOp[] = [];
  const isTs = opts.stack.backend.endsWith('-ts');

  if (isTs) {
    // server.ts 从适配器目录加载（fastify-ts / express-ts 真正差异）
    // 缺失 files/ 视为开发期问题，直接抛错而非静默 fallback（建议 1）
    const serverTemplate = loadAdapterFileOrThrow('backend', opts.stack.backend, 'server.ts.tmpl');
    writes.push({
      path: 'apps/api/src/server.ts',
      content: serverTemplate,
      is_new: true,
      reason: `P1-2 ${opts.stack.backend} 适配器 server.ts`,
    });
    // errors.ts 占位
    writes.push({
      path: 'apps/api/src/errors.ts',
      content: TS_ERRORS_TS,
      is_new: true,
      reason: 'P1-1 errors.ts 骨架',
    });
    // package.json：依赖根据 backend 选型
    const apiDeps: Record<string, string> = { zod: '^3.23.0' };
    if (opts.stack.backend === 'fastify-ts') apiDeps.fastify = '^4.27.0';
    if (opts.stack.backend === 'express-ts') {
      apiDeps.express = '^4.19.0';
      apiDeps['@types/express'] = '^4.17.0';
    }
    writes.push({
      path: 'apps/api/package.json',
      content: JSON.stringify({
        name: `@${opts.project_name}/api`,
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: apiDeps,
        devDependencies: {
          '@types/node': '^22.0.0',
          typescript: '^5.4.0',
          vitest: '^1.6.0',
          tsx: '^4.16.0',
        },
        scripts: {
          dev: 'tsx watch src/server.ts',
          test: 'vitest run',
        },
      }, null, 2) + '\n',
      is_new: true,
      reason: 'P1-2 api 子包（按 backend 动态依赖）',
    });
  } else if (opts.stack.backend === 'fastapi') {
    // FastAPI：从适配器目录加载 main.py.tmpl / requirements.txt.tmpl（P2-8 已提供）
    if (adapterFileExists('backend', 'fastapi', 'main.py.tmpl')) {
      writes.push({
        path: 'app/main.py',
        content: renderAdapterTemplate(loadAdapterFileOrThrow('backend', 'fastapi', 'main.py.tmpl'), opts),
        is_new: true,
        reason: 'P2-8 fastapi 适配器 main.py',
      });
      writes.push({
        path: 'requirements.txt',
        content: renderAdapterTemplate(loadAdapterFileOrThrow('backend', 'fastapi', 'requirements.txt.tmpl'), opts),
        is_new: true,
        reason: 'P2-8 fastapi 依赖清单',
      });
    } else {
      // 兜底：内联骨架（兼容旧版）
      writes.push({ path: 'app/main.py', content: PY_MAIN, is_new: true, reason: 'P1-1 fastapi 骨架（兜底）' });
      warnings.push('fastapi 适配器目录缺 files/main.py.tmpl，使用内联兜底骨架');
    }
  } else if (opts.stack.backend === 'spring-boot') {
    // Spring Boot：从 P2-8 适配器目录加载 Java 模板（不再静默不生成）
    if (!adapterFileExists('backend', 'spring-boot', 'server.java.tmpl')) {
      warnings.push(
        'spring-boot 适配器缺 files/server.java.tmpl，Java 骨架无法生成（experimental 适配器防护，建议 1）',
      );
    } else {
      const groupName = opts.project_name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'demoapp';
      const artifactId = groupName;
      const renderedServer = renderAdapterTemplate(
        loadAdapterFileOrThrow('backend', 'spring-boot', 'server.java.tmpl'),
        opts,
      ).replace('{{group-name}}', groupName).replace('{{artifact-id}}', artifactId);
      writes.push({
        path: `src/main/java/com/example/${artifactId}/Application.java`,
        content: renderedServer,
        is_new: true,
        reason: 'P2-8 spring-boot 适配器 Application.java',
      });
      const renderedHealth = renderAdapterTemplate(
        loadAdapterFileOrThrow('backend', 'spring-boot', 'health.java.tmpl'),
        opts,
      ).replace('{{group-name}}', groupName).replace('{{artifact-id}}', artifactId);
      writes.push({
        path: `src/main/java/com/example/${artifactId}/controller/HealthController.java`,
        content: renderedHealth,
        is_new: true,
        reason: 'P2-8 spring-boot 适配器 HealthController',
      });
      writes.push({
        path: 'pom.xml',
        content: renderAdapterTemplate(
          loadAdapterFileOrThrow('backend', 'spring-boot', 'pom.xml.tmpl'),
          opts,
        ).replace('{{project-name}}', opts.project_name),
        is_new: true,
        reason: 'P2-8 spring-boot 适配器 pom.xml',
      });
    }
  } else {
    // 未知 backend：experimental 防护，显式警告而非静默
    warnings.push(`backend="${opts.stack.backend}" 无对应适配器 files/，apps/api 未生成（experimental 防护）`);
  }

  return writes;
}
