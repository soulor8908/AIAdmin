// test/inject-detector.test.ts —— P2-1 探测引擎测试
// 用 mvp/ 仓 + Phase 1 生成的项目 + 临时造的 Spring Boot / FastAPI 模拟项目验证。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectProject } from '../inject/detector/detector.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MVP_ROOT = join(process.cwd(), '..', 'mvp');

describe('P2-1 项目探测引擎', () => {
  describe('探测 mvp/ 实验期项目', () => {
    it('应识别 TypeScript + Vitest + 相关栈', () => {
      const profile = detectProject(MVP_ROOT);
      expect(profile.language).toBe('typescript');
      expect(profile.package_manager).toBe('npm');
      expect(profile.test_runner).toBeDefined();
      expect(profile.test_runner?.id).toBe('vitest');
    });

    it('应有合理的整体置信度（≥ 0.5）', () => {
      const profile = detectProject(MVP_ROOT);
      expect(profile.overall_confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('应记录所有信号的 source', () => {
      const profile = detectProject(MVP_ROOT);
      expect(profile.signals.length).toBeGreaterThan(0);
      expect(profile.signals.every((s) => s.source.length > 0)).toBe(true);
    });
  });

  describe('探测 fastify-ts + react-vite 模拟项目', () => {
    let fastifyRoot: string;

    beforeEach(() => {
      fastifyRoot = join(tmpdir(), `ai-spec-test-fastify-${Date.now()}`);
      mkdirSync(fastifyRoot, { recursive: true });
      writeFileSync(
        join(fastifyRoot, 'package.json'),
        JSON.stringify({
          name: 'demo-fastify',
          dependencies: {
            fastify: '^4.27.0',
            zod: '^3.23.0',
            react: '^18.3.0',
            vite: '^5.3.0',
          },
          devDependencies: {
            typescript: '^5.4.0',
            vitest: '^1.6.0',
          },
        }),
      );
      writeFileSync(join(fastifyRoot, 'tsconfig.json'), '{}\n');
      writeFileSync(join(fastifyRoot, 'vite.config.ts'), 'export default {};\n');
      writeFileSync(join(fastifyRoot, 'package-lock.json'), '{}\n');
    });

    afterEach(() => {
      rmSync(fastifyRoot, { recursive: true, force: true });
    });

    it('应识别 fastify-ts + react-vite + zod', () => {
      const profile = detectProject(fastifyRoot);
      expect(profile.language).toBe('typescript');
      expect(profile.backend?.id).toBe('fastify-ts');
      expect(profile.frontend?.id).toBe('react-vite');
    });

    it('应识别 npm + vitest', () => {
      const profile = detectProject(fastifyRoot);
      expect(profile.package_manager).toBe('npm');
      expect(profile.test_runner?.id).toBe('vitest');
    });
  });

  describe('探测 Spring Boot 模拟项目', () => {
    let springRoot: string;

    beforeEach(() => {
      springRoot = join(tmpdir(), `ai-spec-test-spring-${Date.now()}`);
      mkdirSync(springRoot, { recursive: true });
      // 模拟 pom.xml
      writeFileSync(
        join(springRoot, 'pom.xml'),
        `<?xml version="1.0"?>
<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.0</version>
  </parent>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-data-jpa</artifactId>
    </dependency>
    <dependency>
      <groupId>org.postgresql</groupId>
      <artifactId>postgresql</artifactId>
    </dependency>
  </dependencies>
</project>`,
      );
    });

    afterEach(() => {
      rmSync(springRoot, { recursive: true, force: true });
    });

    it('应识别 Java + Spring Boot + Maven', () => {
      const profile = detectProject(springRoot);
      expect(profile.language).toBe('java');
      expect(profile.package_manager).toBe('maven');
      expect(profile.backend?.id).toBe('spring-boot');
      expect(profile.backend?.version).toBe('3.2.0');
    });

    it('应识别 Spring Data JPA + PostgreSQL', () => {
      const profile = detectProject(springRoot);
      expect(profile.orm?.id).toBe('spring-data-jpa');
      expect(profile.db?.id).toBe('postgresql');
    });

    it('应有 ≥ 0.9 的整体置信度', () => {
      const profile = detectProject(springRoot);
      expect(profile.overall_confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('探测 FastAPI 模拟项目', () => {
    let fastapiRoot: string;

    beforeEach(() => {
      fastapiRoot = join(tmpdir(), `ai-spec-test-fastapi-${Date.now()}`);
      mkdirSync(fastapiRoot, { recursive: true });
      writeFileSync(
        join(fastapiRoot, 'requirements.txt'),
        `fastapi==0.111.0
uvicorn[standard]==0.30.0
sqlalchemy==2.0.30
asyncpg==0.29.0
pydantic==2.7.0
pytest==8.2.0
`,
      );
    });

    afterEach(() => {
      rmSync(fastapiRoot, { recursive: true, force: true });
    });

    it('应识别 Python + FastAPI + pip', () => {
      const profile = detectProject(fastapiRoot);
      expect(profile.language).toBe('python');
      expect(profile.backend?.id).toBe('fastapi');
      expect(profile.backend?.version).toBe('0.111.0');
    });

    it('应识别 SQLAlchemy + PostgreSQL + pydantic + pytest', () => {
      const profile = detectProject(fastapiRoot);
      expect(profile.orm?.id).toBe('sqlalchemy');
      expect(profile.db?.id).toBe('postgresql');
      expect(profile.signals.some((s) => s.detected === 'pydantic')).toBe(true);
      expect(profile.test_runner?.id).toBe('pytest');
    });
  });

  describe('探测 CI 配置', () => {
    let ciRoot: string;

    beforeEach(() => {
      ciRoot = join(tmpdir(), `ai-spec-test-ci-${Date.now()}`);
      mkdirSync(join(ciRoot, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(ciRoot, '.github', 'workflows', 'test.yml'), 'name: test\n');
    });

    afterEach(() => {
      rmSync(ciRoot, { recursive: true, force: true });
    });

    it('应识别 GitHub Actions', () => {
      const profile = detectProject(ciRoot);
      expect(profile.ci?.id).toBe('github-actions');
    });
  });

  describe('探测空目录', () => {
    it('应返回 unknown 语言 + 整体置信度 0', () => {
      const emptyRoot = join(tmpdir(), `ai-spec-test-empty-${Date.now()}`);
      mkdirSync(emptyRoot, { recursive: true });
      try {
        const profile = detectProject(emptyRoot);
        expect(profile.language).toBe('unknown');
        expect(profile.overall_confidence).toBe(0);
        expect(profile.warnings.length).toBeGreaterThan(0);
      } finally {
        rmSync(emptyRoot, { recursive: true, force: true });
      }
    });
  });
});
