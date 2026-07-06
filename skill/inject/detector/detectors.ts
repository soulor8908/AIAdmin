// inject/detector/detectors.ts —— 各语言/框架的探测规则
// P2-1 产出：每个探测规则是一个函数，输入文件清单 + 内容，输出信号列表。
//
// 设计原则：
// - 每个探测器只看一种信号源（package.json / pom.xml / etc.）
// - 多信号融合在 detector.ts 主流程完成
// - 单探测器不抛错（缺文件返回空数组）

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DetectSignal } from './types.js';

export type Detector = {
  /** 探测器 ID（用于审计） */
  id: string;
  /** 探测的根文件（相对项目根） */
  targets: string[];
  /** 执行探测 */
  detect: (rootDir: string) => DetectSignal[];
};

// ============ Node.js / TypeScript ============

export const packageJsonDetector: Detector = {
  id: 'package-json',
  targets: ['package.json'],
  detect(rootDir) {
    const path = join(rootDir, 'package.json');
    if (!existsSync(path)) return [];
    const signals: DetectSignal[] = [];
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return [{ source: 'package.json', kind: 'manifest', detected: 'nodejs', confidence: 0.3 }];
    }
    signals.push({ source: 'package.json', kind: 'manifest', detected: 'nodejs', confidence: 1.0 });

    const allDeps: Record<string, string> = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
    };

    // TypeScript
    if (allDeps['typescript']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'typescript',
        confidence: 1.0,
        meta: { version: allDeps['typescript'] },
      });
    }

    // 后端框架
    if (allDeps['fastify']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'fastify-ts',
        confidence: 0.95,
        meta: { version: allDeps['fastify'] },
      });
    }
    if (allDeps['express']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'express-ts',
        confidence: 0.95,
        meta: { version: allDeps['express'] },
      });
    }

    // 前端框架
    if (allDeps['react']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'react-vite',
        confidence: allDeps['vite'] ? 0.95 : 0.7,
        meta: { react_version: allDeps['react'], vite_version: allDeps['vite'] ?? '' },
      });
    }
    if (allDeps['vue']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'vue3-vite',
        confidence: allDeps['vite'] ? 0.9 : 0.6,
        meta: { vue_version: allDeps['vue'] },
      });
    }
    if (allDeps['@angular/core']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'angular',
        confidence: 0.9,
        meta: { version: allDeps['@angular/core'] },
      });
    }

    // 契约库
    if (allDeps['zod']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'zod',
        confidence: 0.95,
        meta: { version: allDeps['zod'] },
      });
    }

    // ORM
    if (allDeps['prisma'] || allDeps['@prisma/client']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'prisma',
        confidence: 0.95,
      });
    }
    if (allDeps['typeorm']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'typeorm',
        confidence: 0.95,
      });
    }
    if (allDeps['sequelize']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'sequelize',
        confidence: 0.95,
      });
    }
    if (allDeps['drizzle-orm']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'drizzle',
        confidence: 0.95,
      });
    }

    // 测试框架
    if (allDeps['vitest']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'vitest',
        confidence: 0.95,
      });
    }
    if (allDeps['jest']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'jest',
        confidence: 0.95,
      });
    }

    // 认证
    if (allDeps['jsonwebtoken']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'jwt',
        confidence: 0.9,
      });
    }
    if (allDeps['express-session']) {
      signals.push({
        source: 'package.json',
        kind: 'manifest',
        detected: 'session',
        confidence: 0.9,
      });
    }

    return signals;
  },
};

export const lockfileDetector: Detector = {
  id: 'lockfile',
  targets: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'],
  detect(rootDir) {
    const signals: DetectSignal[] = [];
    if (existsSync(join(rootDir, 'package-lock.json'))) {
      signals.push({ source: 'package-lock.json', kind: 'lockfile', detected: 'npm', confidence: 1.0 });
    }
    if (existsSync(join(rootDir, 'pnpm-lock.yaml'))) {
      signals.push({ source: 'pnpm-lock.yaml', kind: 'lockfile', detected: 'pnpm', confidence: 1.0 });
    }
    if (existsSync(join(rootDir, 'yarn.lock'))) {
      signals.push({ source: 'yarn.lock', kind: 'lockfile', detected: 'yarn', confidence: 1.0 });
    }
    return signals;
  },
};

// ============ Java / Spring ============

export const pomXmlDetector: Detector = {
  id: 'pom-xml',
  targets: ['pom.xml'],
  detect(rootDir) {
    const path = join(rootDir, 'pom.xml');
    if (!existsSync(path)) return [];
    const content = readFileSync(path, 'utf8');
    const signals: DetectSignal[] = [
      { source: 'pom.xml', kind: 'manifest', detected: 'java', confidence: 1.0 },
      { source: 'pom.xml', kind: 'manifest', detected: 'maven', confidence: 1.0 },
    ];

    // Spring Boot
    if (content.includes('spring-boot-starter-parent') || content.includes('spring-boot-starter-web')) {
      const m = content.match(/spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)/);
      signals.push({
        source: 'pom.xml',
        kind: 'manifest',
        detected: 'spring-boot',
        confidence: 1.0,
        meta: { version: m?.[1] ?? 'unknown' },
      });
    }

    // Spring Boot starters
    if (content.includes('spring-boot-starter-data-jpa')) {
      signals.push({ source: 'pom.xml', kind: 'manifest', detected: 'spring-data-jpa', confidence: 1.0 });
    }
    if (content.includes('spring-boot-starter-data-mongodb')) {
      signals.push({ source: 'pom.xml', kind: 'manifest', detected: 'spring-data-mongo', confidence: 1.0 });
    }

    // Database drivers
    if (content.includes('postgresql</artifactId>') || content.includes('postgresql')) {
      signals.push({ source: 'pom.xml', kind: 'manifest', detected: 'postgresql', confidence: 0.8 });
    }
    if (content.includes('mysql-connector-java') || content.includes('mysql-connector-j')) {
      signals.push({ source: 'pom.xml', kind: 'manifest', detected: 'mysql', confidence: 0.8 });
    }

    // Test
    if (content.includes('spring-boot-starter-test') || content.includes('junit')) {
      signals.push({ source: 'pom.xml', kind: 'manifest', detected: 'junit', confidence: 0.95 });
    }

    // Security
    if (content.includes('spring-boot-starter-security')) {
      signals.push({ source: 'pom.xml', kind: 'manifest', detected: 'spring-security', confidence: 0.9 });
    }

    return signals;
  },
};

export const gradleDetector: Detector = {
  id: 'gradle',
  targets: ['build.gradle', 'build.gradle.kts'],
  detect(rootDir) {
    const gradlePath = ['build.gradle', 'build.gradle.kts'].find((f) => existsSync(join(rootDir, f)));
    if (!gradlePath) return [];
    const content = readFileSync(join(rootDir, gradlePath), 'utf8');
    const signals: DetectSignal[] = [
      { source: gradlePath, kind: 'manifest', detected: 'java', confidence: 1.0 },
      { source: gradlePath, kind: 'manifest', detected: 'gradle', confidence: 1.0 },
    ];

    if (content.includes('org.springframework.boot')) {
      signals.push({
        source: gradlePath,
        kind: 'manifest',
        detected: 'spring-boot',
        confidence: 1.0,
      });
    }
    if (content.includes('org.springframework.data:spring-data-jpa')) {
      signals.push({ source: gradlePath, kind: 'manifest', detected: 'spring-data-jpa', confidence: 1.0 });
    }

    return signals;
  },
};

// ============ Python ============

export const pythonDepsDetector: Detector = {
  id: 'python-deps',
  targets: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'],
  detect(rootDir) {
    const signals: DetectSignal[] = [];
    const files: string[] = [];
    for (const f of ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile']) {
      if (existsSync(join(rootDir, f))) files.push(f);
    }
    if (files.length === 0) return signals;

    signals.push({ source: files[0], kind: 'manifest', detected: 'python', confidence: 1.0 });
    if (files.includes('pyproject.toml')) {
      signals.push({ source: 'pyproject.toml', kind: 'manifest', detected: 'poetry', confidence: 0.8 });
    }
    if (files.includes('Pipfile')) {
      signals.push({ source: 'Pipfile', kind: 'manifest', detected: 'pipenv', confidence: 0.9 });
    }

    // 检查 FastAPI / Flask / Django
    for (const f of files) {
      const content = readFileSync(join(rootDir, f), 'utf8');
      if (/^\s*fastapi([=<>]|$)/m.test(content) || content.includes('"fastapi"')) {
        const m = content.match(/fastapi[=<>]+\s*([0-9.]+)/);
        signals.push({
          source: f,
          kind: 'manifest',
          detected: 'fastapi',
          confidence: 1.0,
          meta: { version: m?.[1] ?? 'unknown' },
        });
      }
      if (/^\s*flask([=<>]|$)/m.test(content) || content.includes('"flask"')) {
        signals.push({ source: f, kind: 'manifest', detected: 'flask', confidence: 1.0 });
      }
      if (/^\s*django([=<>]|$)/m.test(content) || content.includes('"django"')) {
        signals.push({ source: f, kind: 'manifest', detected: 'django', confidence: 1.0 });
      }
      if (/^\s*pydantic([=<>]|$)/m.test(content) || content.includes('"pydantic"')) {
        signals.push({ source: f, kind: 'manifest', detected: 'pydantic', confidence: 1.0 });
      }
      if (/^\s*sqlalchemy([=<>]|$)/m.test(content) || content.includes('"sqlalchemy"')) {
        signals.push({ source: f, kind: 'manifest', detected: 'sqlalchemy', confidence: 1.0 });
      }
      if (content.includes('psycopg2') || content.includes('asyncpg')) {
        signals.push({ source: f, kind: 'manifest', detected: 'postgresql', confidence: 0.85 });
      }
      if (content.includes('pymysql') || content.includes('mysqlclient')) {
        signals.push({ source: f, kind: 'manifest', detected: 'mysql', confidence: 0.85 });
      }
      if (content.includes('pytest')) {
        signals.push({ source: f, kind: 'manifest', detected: 'pytest', confidence: 1.0 });
      }
    }

    return signals;
  },
};

// ============ CI 配置 ============

export const ciDetector: Detector = {
  id: 'ci-config',
  targets: ['.github/workflows', '.gitlab-ci.yml', '.circleci/config.yml', 'Jenkinsfile'],
  detect(rootDir) {
    const signals: DetectSignal[] = [];
    const ghDir = join(rootDir, '.github', 'workflows');
    if (existsSync(ghDir)) {
      signals.push({
        source: '.github/workflows/',
        kind: 'config',
        detected: 'github-actions',
        confidence: 1.0,
      });
    }
    if (existsSync(join(rootDir, '.gitlab-ci.yml'))) {
      signals.push({
        source: '.gitlab-ci.yml',
        kind: 'config',
        detected: 'gitlab-ci',
        confidence: 1.0,
      });
    }
    if (existsSync(join(rootDir, '.circleci', 'config.yml'))) {
      signals.push({
        source: '.circleci/config.yml',
        kind: 'config',
        detected: 'circleci',
        confidence: 1.0,
      });
    }
    if (existsSync(join(rootDir, 'Jenkinsfile'))) {
      signals.push({
        source: 'Jenkinsfile',
        kind: 'config',
        detected: 'jenkins',
        confidence: 1.0,
      });
    }
    return signals;
  },
};

// ============ 源码文件名模式 ============

export const sourcePatternDetector: Detector = {
  id: 'source-pattern',
  targets: [],
  detect(rootDir) {
    // 简化版：只看根目录下的关键文件，避免深层遍历
    const signals: DetectSignal[] = [];
    if (existsSync(join(rootDir, 'tsconfig.json'))) {
      signals.push({ source: 'tsconfig.json', kind: 'config', detected: 'typescript', confidence: 1.0 });
    }
    if (existsSync(join(rootDir, 'vite.config.ts')) || existsSync(join(rootDir, 'vite.config.js'))) {
      signals.push({ source: 'vite.config', kind: 'config', detected: 'vite', confidence: 1.0 });
    }
    if (existsSync(join(rootDir, 'webpack.config.js'))) {
      signals.push({ source: 'webpack.config.js', kind: 'config', detected: 'webpack', confidence: 1.0 });
    }
    if (existsSync(join(rootDir, 'Dockerfile'))) {
      signals.push({ source: 'Dockerfile', kind: 'config', detected: 'docker', confidence: 1.0 });
    }
    return signals;
  },
};

// ============ DB 探测（看 .env / config 文件） ============

export const dbConfigDetector: Detector = {
  id: 'db-config',
  targets: ['.env', 'config/database.js', 'config/database.ts', 'application.yml', 'application.properties'],
  detect(rootDir) {
    const signals: DetectSignal[] = [];
    const candidates = [
      '.env',
      'config/database.js',
      'config/database.ts',
      'src/main/resources/application.yml',
      'src/main/resources/application.properties',
    ];
    for (const f of candidates) {
      const path = join(rootDir, f);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, 'utf8');
      if (/postgres(ql)?/i.test(content)) {
        signals.push({ source: f, kind: 'config', detected: 'postgresql', confidence: 0.7 });
      }
      if (/mysql/i.test(content)) {
        signals.push({ source: f, kind: 'config', detected: 'mysql', confidence: 0.7 });
      }
      if (/mongodb/i.test(content)) {
        signals.push({ source: f, kind: 'config', detected: 'mongodb', confidence: 0.7 });
      }
      if (/sqlite/i.test(content)) {
        signals.push({ source: f, kind: 'config', detected: 'sqlite', confidence: 0.7 });
      }
    }
    return signals;
  },
};

// ============ 全部探测器 ============

export const ALL_DETECTORS: Detector[] = [
  packageJsonDetector,
  lockfileDetector,
  pomXmlDetector,
  gradleDetector,
  pythonDepsDetector,
  ciDetector,
  sourcePatternDetector,
  dbConfigDetector,
];
