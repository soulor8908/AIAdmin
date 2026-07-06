// test/spec-completeness.test.ts —— P3-5 Spec 完整性评分器测试

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scoreSpec } from '../intelligence/spec-completeness.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('P3-5 Spec 完整性评分器', () => {
  let specDir: string;
  let specPath: string;

  beforeEach(() => {
    specDir = join(tmpdir(), `ai-spec-test-spec-${Date.now()}`);
    mkdirSync(specDir, { recursive: true });
    specPath = join(specDir, 'user.tech.md');
  });

  afterEach(() => {
    if (rmSync) rmSync(specDir, { recursive: true, force: true });
  });

  it('不存在的文件应返回 0 分', () => {
    const result = scoreSpec(join(specDir, 'no-exist.md'));
    expect(result.total_score).toBe(0);
    expect(result.suggestions[0]).toContain('不存在');
  });

  it('完整 Spec 应得到 ≥ 60 分', () => {
    writeFileSync(
      specPath,
      `# User Tech-Spec

## 1 · 上下文
背景：实现用户管理。现状：无。目标：注册登录。

## 2 · 架构层映射
- domain: src/domain/user.ts
- repository: src/repository/userRepository.ts
- service: src/service/userService.ts
- router: src/router/userRouter.ts

## 3 · 契约层
- userOutput schema
- userStorage schema
- createUserInput
- userRole enum

## 4 · 受影响规则
- ARCH-001
- SEC-001
- CODE-001
- USER-001

## 5 · 数据模型
CREATE TABLE users (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ
);

## 6 · 错误码
- DUPLICATE_USER
- USER_NOT_FOUND
- INVALID_CREDENTIALS

## 7 · 测试用例
- Given 注册场景
- When 调用 POST /users
- Then 断言返回 201
- 断言不含 password

## 8 · BLOCKING 决策
- Q1: JWT TTL 决定

## 9 · 受影响清单
- contracts: 新增 user schemas
- router: 新增 user router
- service: 新增 userService
`,
    );
    const result = scoreSpec(specPath);
    expect(result.total_score).toBeGreaterThanOrEqual(60);
  });

  it('空 Spec 应得到 ≤ 30 分', () => {
    writeFileSync(specPath, '# Empty Spec\n\nThis is empty.');
    const result = scoreSpec(specPath);
    expect(result.total_score).toBeLessThanOrEqual(30);
  });

  it('应输出 markdown 报告', () => {
    writeFileSync(specPath, '# Spec\n\n## 2 · 架构\n- domain\n');
    const result = scoreSpec(specPath);
    expect(result.markdown_report).toContain('Spec 完整性评分');
    expect(result.markdown_report).toContain('章节得分');
  });
});
