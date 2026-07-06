// test/skill-pkg.test.ts —— P3-1/P3-4 Skill 包加载 + 验证 + 组合测试

import { describe, it, expect } from 'vitest';
import { loadSkill, discoverSkills, loadSkillFull, defaultBuiltinSkillsDir } from '../skill-pkg/loader.js';
import { validateSkillManifest } from '../skill-pkg/validator.js';
import { SkillComposer } from '../skill-pkg/composer.js';
import { LocalRegistry } from '../registry/registry.js';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const SKILLS_DIR = defaultBuiltinSkillsDir();

describe('P3-1 Skill 包加载 + 验证', () => {
  it('应能加载 @core/user-mgmt skill', () => {
    const result = loadSkill(join(SKILLS_DIR, 'user-mgmt'));
    expect(result.ok).toBe(true);
    expect(result.manifest?.package.name).toBe('@core/user-mgmt');
    expect(result.manifest?.package.version).toBe('0.1.0');
    expect(result.manifest?.package.category).toBe('domain');
  });

  it('应能加载 @core/audit-log skill', () => {
    const result = loadSkill(join(SKILLS_DIR, 'audit-log'));
    expect(result.ok).toBe(true);
    expect(result.manifest?.package.name).toBe('@core/audit-log');
  });

  it('discoverSkills 应发现 5 个 skill', () => {
    const { skills, logs } = discoverSkills(SKILLS_DIR);
    expect(skills.length).toBeGreaterThanOrEqual(5);
    const names = skills.map((s) => s.manifest.package.name);
    expect(names).toContain('@core/user-mgmt');
    expect(names).toContain('@core/audit-log');
    expect(names).toContain('@community/rbac-spec');
    expect(names).toContain('@core/notification');
    expect(names).toContain('@community/i18n-spec');
  });

  it('loadSkillFull 应展开产物文件清单', () => {
    const { loaded } = loadSkillFull(join(SKILLS_DIR, 'user-mgmt'));
    expect(loaded).toBeDefined();
    expect(loaded!.rule_files.length).toBeGreaterThan(0);
    expect(loaded!.template_files.length).toBeGreaterThan(0);
    expect(loaded!.role_prompt_files.length).toBeGreaterThan(0);
    expect(loaded!.contract_files.length).toBeGreaterThan(0);
  });

  it('validator 应拒绝无 name 的 manifest', () => {
    const manifest = {
      package: { name: '', version: '0.1.0', description: '', author: '', license: 'MIT', category: 'domain' },
      compatibility: { requires_kernel_version: '>=0.1.0', supported_stacks: [] },
      artifacts: { rules: [], templates: [], role_prompts: [], adapters: [], contracts: [] },
      dependencies: { depends_on: [], conflicts_with: [] },
      overrides: { rules: {}, templates: {} },
      manifest_path: '/tmp/x',
      skill_dir: '/tmp/x',
    };
    const result = validateSkillManifest(manifest as never);
    expect(result.errors.some((e) => e.includes('name 必填'))).toBe(true);
  });

  it('validator 应拒绝非命名空间格式的 name', () => {
    const manifest = {
      package: { name: 'invalid-name', version: '0.1.0', description: 'x', author: '', license: 'MIT', category: 'domain' },
      compatibility: { requires_kernel_version: '>=0.1.0', supported_stacks: [] },
      artifacts: { rules: [], templates: [], role_prompts: [], adapters: [], contracts: [] },
      dependencies: { depends_on: [], conflicts_with: [] },
      overrides: { rules: {}, templates: {} },
      manifest_path: '/tmp/x',
      skill_dir: '/tmp/x',
    };
    const result = validateSkillManifest(manifest as never);
    expect(result.errors.some((e) => e.includes('命名空间'))).toBe(true);
  });

  it('validator 应检测 conflicts_with 包含自身', () => {
    const manifest = {
      package: { name: '@core/x', version: '0.1.0', description: '', author: '', license: 'MIT', category: 'domain' },
      compatibility: { requires_kernel_version: '>=0.1.0', supported_stacks: [] },
      artifacts: { rules: [], templates: [], role_prompts: [], adapters: [], contracts: [] },
      dependencies: { depends_on: [], conflicts_with: ['@core/x'] },
      overrides: { rules: {}, templates: {} },
      manifest_path: '/tmp/x',
      skill_dir: '/tmp/x',
    };
    const result = validateSkillManifest(manifest as never);
    expect(result.errors.some((e) => e.includes('conflicts_with 不能包含自身'))).toBe(true);
  });
});

describe('P3-2 Skill Registry', () => {
  let projectRoot: string;

  function setup(): void {
    projectRoot = join(tmpdir(), `ai-spec-test-registry-${Date.now()}`);
    mkdirSync(projectRoot, { recursive: true });
  }

  function teardown(): void {
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
  }

  it('list 应返回 5 个 builtin skill', () => {
    setup();
    try {
      const registry = new LocalRegistry(projectRoot);
      const entries = registry.list();
      expect(entries.length).toBeGreaterThanOrEqual(5);
      expect(entries.every((e) => e.source === 'builtin')).toBe(true);
    } finally {
      teardown();
    }
  });

  it('search 应能按关键词匹配', () => {
    setup();
    try {
      const registry = new LocalRegistry(projectRoot);
      const result = registry.search('user');
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches.some((m) => m.name === '@core/user-mgmt')).toBe(true);
    } finally {
      teardown();
    }
  });

  it('add 应把 skill 复制到项目级目录', () => {
    setup();
    try {
      const registry = new LocalRegistry(projectRoot);
      const { installed } = registry.add('@core/user-mgmt');
      expect(installed.name).toBe('@core/user-mgmt');
      expect(existsSync(installed.install_path)).toBe(true);

      // 二次 list 应有 1 个 installed
      const entries = registry.list();
      const installedEntry = entries.find((e) => e.source !== 'builtin');
      expect(installedEntry).toBeDefined();
    } finally {
      teardown();
    }
  });

  it('remove 应删除项目级副本', () => {
    setup();
    try {
      const registry = new LocalRegistry(projectRoot);
      registry.add('@core/user-mgmt');
      const { removed } = registry.remove('@core/user-mgmt');
      expect(removed).toBe(true);
      const entries = registry.list();
      expect(entries.every((e) => e.source === 'builtin')).toBe(true);
    } finally {
      teardown();
    }
  });
});

describe('P3-4 Skill 组合机制', () => {
  let projectRoot: string;

  function setup(): void {
    projectRoot = join(tmpdir(), `ai-spec-test-compose-${Date.now()}`);
    mkdirSync(projectRoot, { recursive: true });
  }

  function teardown(): void {
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
  }

  it('compose 应合并 user-mgmt + audit-log 的规则', () => {
    setup();
    try {
      const registry = new LocalRegistry(projectRoot);
      registry.add('@core/user-mgmt');
      registry.add('@core/audit-log');
      const composer = new SkillComposer(registry);
      const result = composer.compose(['@core/user-mgmt', '@core/audit-log']);
      expect(result.errors).toEqual([]);
      expect(result.rules.length).toBeGreaterThan(5);
      // 命名空间：每条规则的全局键应是 @core/user-mgmt/USER-XXX 或 @core/audit-log/AUDIT-XXX
      expect(result.rules.some((r) => r.namespaced_id.startsWith('@core/user-mgmt/USER-'))).toBe(true);
      expect(result.rules.some((r) => r.namespaced_id.startsWith('@core/audit-log/AUDIT-'))).toBe(true);
    } finally {
      teardown();
    }
  });

  it('compose 应检测缺失依赖', () => {
    setup();
    try {
      const registry = new LocalRegistry(projectRoot);
      // 不安装任何 skill，直接 compose
      const composer = new SkillComposer(registry);
      const result = composer.compose(['@core/user-mgmt']);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('未安装');
    } finally {
      teardown();
    }
  });

  it('compose 应合并契约元模型', () => {
    setup();
    try {
      const registry = new LocalRegistry(projectRoot);
      registry.add('@core/user-mgmt');
      registry.add('@core/audit-log');
      const composer = new SkillComposer(registry);
      const result = composer.compose(['@core/user-mgmt', '@core/audit-log']);
      expect(result.contracts.length).toBeGreaterThan(5);
      const names = result.contracts.map((c) => c.namespaced_name);
      expect(names.some((n) => n.includes('userOutput'))).toBe(true);
      expect(names.some((n) => n.includes('auditLogOutput'))).toBe(true);
    } finally {
      teardown();
    }
  });

  it('compose 应检测隐式模板覆盖（未在 overrides 声明）', () => {
    setup();
    try {
      // 造两个 skill 同名模板但未声明 overrides
      const skillADir = join(projectRoot, '.ai-spec', 'skills', '_core_a');
      const skillBDir = join(projectRoot, '.ai-spec', 'skills', '_core_b');
      mkdirSync(join(skillADir, 'templates'), { recursive: true });
      mkdirSync(join(skillBDir, 'templates'), { recursive: true });
      writeFileSync(
        join(skillADir, 'skill.yaml'),
        `package:
  name: '@core/a'
  version: '0.1.0'
  description: 'A'
  author: 'test'
  license: 'MIT'
  category: 'domain'
compatibility: { requires_kernel_version: '>=0.1.0', supported_stacks: [] }
artifacts: { rules: [], templates: ['templates/x.hbs'], role_prompts: [], adapters: [], contracts: [] }
dependencies: { depends_on: [], conflicts_with: [] }
overrides: { rules: {}, templates: {} }
`,
      );
      writeFileSync(join(skillADir, 'templates', 'x.hbs'), 'A content');
      writeFileSync(
        join(skillBDir, 'skill.yaml'),
        `package:
  name: '@core/b'
  version: '0.1.0'
  description: 'B'
  author: 'test'
  license: 'MIT'
  category: 'domain'
compatibility: { requires_kernel_version: '>=0.1.0', supported_stacks: [] }
artifacts: { rules: [], templates: ['templates/x.hbs'], role_prompts: [], adapters: [], contracts: [] }
dependencies: { depends_on: [], conflicts_with: [] }
overrides: { rules: {}, templates: {} }
`,
      );
      writeFileSync(join(skillBDir, 'templates', 'x.hbs'), 'B content');

      // 直接构造 LocalRegistry 指向 projectRoot
      // 但 LocalRegistry 默认 builtin 目录在 skill/skills，我们需要用 installed 索引
      // 直接构造 registry + 手动写入 installed.json
      const indexPath = join(projectRoot, '.ai-spec', 'skills', 'installed.json');
      writeFileSync(
        indexPath,
        JSON.stringify(
          [
            {
              name: '@core/a',
              version: '0.1.0',
              installed_at: new Date().toISOString(),
              install_path: skillADir,
              source: 'local',
            },
            {
              name: '@core/b',
              version: '0.1.0',
              installed_at: new Date().toISOString(),
              install_path: skillBDir,
              source: 'local',
            },
          ],
          null,
          2,
        ),
      );

      const registry = new LocalRegistry(projectRoot);
      const composer = new SkillComposer(registry);
      const result = composer.compose(['@core/a', '@core/b']);
      expect(result.errors.some((e) => e.includes('隐式模板覆盖'))).toBe(true);
    } finally {
      teardown();
    }
  });
});
