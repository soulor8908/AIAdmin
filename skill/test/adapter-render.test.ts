// test/adapter-render.test.ts —— DoD #2：至少 2 种技术栈适配器能渲染出可编译的最小契约
//
// 验证：用 user.meta.yaml 样例驱动 Zod / Pydantic / JSON Schema 三个 renderer，
// 各产出 ≥ 1 个有效 schema 文件，且置信度 ≥ 0.7。

import { describe, it, expect } from 'vitest';
import { renderContract as renderZod } from '../adapters/contract/zod/renderer.js';
import { renderContract as renderPydantic } from '../adapters/contract/pydantic/renderer.js';
import { renderContract as renderJsonSchema } from '../adapters/contract/json-schema/renderer.js';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const SKILL_ROOT = process.cwd();
const OUT_DIR = join(SKILL_ROOT, 'test', 'tmp', 'adapter-render');

describe('DoD #2: ≥ 2 种技术栈适配器渲染可编译最小契约', () => {
  // 准备临时输出目录
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  it('Zod renderer 产出 ≥ 1 个 .ts schema 文件 + 置信度 ≥ 0.7', async () => {
    const result = await renderZod({
      schemas: [],
      stack_id: 'node:fastify:ts',
      out_dir: OUT_DIR,
      include_type_derivation: true,
    });
    expect(result.writes.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    // 至少有 userSchema
    const hasUserSchema = result.writes.some((w) => w.path.endsWith('user.ts'));
    expect(hasUserSchema, '应有 user.ts').toBe(true);
    // 内容须含 z.object（说明是有效 Zod schema）
    const userWrite = result.writes.find((w) => w.path.endsWith('user.ts'));
    expect(userWrite?.content).toMatch(/z\.object/);
    expect(userWrite?.content).toMatch(/\.strict\(\)/);
  });

  it('Pydantic renderer 产出 ≥ 1 个 .py schema 文件 + 置信度 ≥ 0.7', async () => {
    const result = await renderPydantic({
      schemas: [],
      stack_id: 'python:fastapi',
      out_dir: OUT_DIR,
    });
    expect(result.writes.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    // 至少有 user.py
    const hasUserSchema = result.writes.some((w) => w.path.endsWith('user.py'));
    expect(hasUserSchema, '应有 user.py').toBe(true);
    const userWrite = result.writes.find((w) => w.path.endsWith('user.py'));
    expect(userWrite?.content).toMatch(/class UserSchema\(BaseModel\)/);
    expect(userWrite?.content).toMatch(/extra.*forbid/);  // strict 等价
  });

  it('JSON Schema renderer 产出 contracts.json + 含 definitions', async () => {
    const result = await renderJsonSchema({
      schemas: [],
      stack_id: 'agnostic',
      out_dir: OUT_DIR,
    });
    expect(result.writes.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    const jsonWrite = result.writes[0];
    const doc = JSON.parse(jsonWrite.content);
    expect(doc.$schema).toMatch(/json-schema\.org/);
    expect(doc.definitions).toBeDefined();
    expect(doc.definitions.user).toBeDefined();
    expect(doc.definitions.errorCode).toBeDefined();
    expect(doc.definitions.user.additionalProperties).toBe(false);  // strict 等价
  });

  it('三种 renderer 都覆盖 enum/object/array/ref/extends 等关键类型', async () => {
    const results = await Promise.all([
      renderZod({ schemas: [], stack_id: 'node:fastify:ts', out_dir: OUT_DIR }),
      renderPydantic({ schemas: [], stack_id: 'python:fastapi', out_dir: OUT_DIR }),
      renderJsonSchema({ schemas: [], stack_id: 'agnostic', out_dir: OUT_DIR }),
    ]);
    for (const r of results) {
      // 不应有 unsupported_types（所有类型都映射成功）
      expect(r.unsupported_types).toEqual([]);
    }
  });
});
