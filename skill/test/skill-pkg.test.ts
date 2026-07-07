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
  it('应能加载 user-mgmt skill', () => {
    const result = loadSkill(join(SKILLS_DIR, 'user-mgmt'));
    expect(result.ok).toBe(true);
    expect(result.manifest?.package.name).toBe('user-mgmt');
    expect(result.manifest?.package.version).toBe('0.1.0');
    expect(result.manifest?.package.category).toBe('domain');
  });

  it('应能加载 audit-log skill', () => {
    const result = loadSkill(join(SKILLS_DIR, 'audit-log'));
    expect(result.ok).toBe(true);
    expect(result.manifest?.package.name).toBe('audit-log');
  });

  it('discoverSkills 应发现 5 个 skill', () => {
    const { skills, logs } = discoverSkills(SKILLS_DIR);
    expect(skills.length).toBeGreaterThanOrEqual(5);
    const names = skills.map((s) => s.manifest.package.name);
    expect(names).toContain('user-mgmt');
    expect(names).toContain('audit-log');
    expect(names).toContain('rbac-spec');
    expect(names).toContain('notification');
    expect(names).toContain('i18n-spec');
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

  it('validator 应拒绝非法 name（含非法字符）', () => {
    const manifest = {
      package: { name: 'invalid_name!', version: '0.1.0', description: 'x', author: '', license: 'MIT', category: 'domain' },
      compatibility: { requires_kernel_version: '>=0.1.0', supported_stacks: [] },
      artifacts: { rules: [], templates: [], role_prompts: [], adapters: [], contracts: [] },
      dependencies: { depends_on: [], conflicts_with: [] },
      overrides: { rules: {}, templates: {} },
      manifest_path: '/tmp/x',
      skill_dir: '/tmp/x',
    };
    const result = validateSkillManifest(manifest as never);
    expect(result.errors.some((e) => e.includes('不合法'))).toBe(true);
  });

  it('validator 应接受简单名 name（建议 6：去掉 @core/ 前缀）', () => {
    const manifest = {
      package: { name: 'user-mgmt', version: '0.1.0', description: 'x', author: '', license: 'MIT', category: 'domain' },
      compatibility: { requires_kernel_version: '>=0.1.0', supported_stacks: [] },
      artifacts: { rules: [], templates: [], role_prompts: [], adapters: [], contracts: [] },
      dependencies: { depends_on: [], conflicts_with: [] },
      overrides: { rules: {}, templates: {} },
      manifest_path: '/tmp/x',
      skill_dir: '/tmp/x',
    };
    const result = validateSkillManifest(manifest as never);
    expect(result.errors.some((e) => e.includes('name'))).toBe(false);
  });

  it('validator 应检测 conflicts_with 包含自身', () => {
    const manifest = {
      package: { name: 'x', version: '0.1.0', description: '', author: '', license: 'MIT', category: 'domain' },
      compatibility: { requires_kernel_version: '>=0.1.0', supported_stacks: [] },
      artifacts: { rules: [], templates: [], role_prompts: [], adapters: [], contracts: [] },
      dependencies: { depends_on: [], conflicts_with: ['x'] },
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
      expect(result.matches.some((m) => m.name === 'user-mgmt')).toBe(true);
    } finally {
      teardown();
    }
  });

  it('add 应把 skill 复制到项目级目录', () => {
    setup();
    try {
      const registry = new LocalRegistry(projectRoot);
      const { installed } = registry.add('user-mgmt');
      expect(installed.name).toBe('user-mgmt');
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
      registry.add('user-mgmt');
      const { removed } = registry.remove('user-mgmt');
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
      registry.add('user-mgmt');
      registry.add('audit-log');
      const composer = new SkillComposer(registry);
      const result = composer.compose(['user-mgmt', 'audit-log']);
      expect(result.errors).toEqual([]);
      expect(result.rules.length).toBeGreaterThan(5);
      // 命名空间：每条规则的全局键应是 user-mgmt/USER-XXX 或 audit-log/AUDIT-XXX（建议 6：简单名）
      expect(result.rules.some((r) => r.namespaced_id.startsWith('user-mgmt/USER-'))).toBe(true);
      expect(result.rules.some((r) => r.namespaced_id.startsWith('audit-log/AUDIT-'))).toBe(true);
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
      const result = composer.compose(['user-mgmt']);
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
      registry.add('user-mgmt');
      registry.add('audit-log');
      const composer = new SkillComposer(registry);
      const result = composer.compose(['user-mgmt', 'audit-log']);
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
      const skillADir = join(projectRoot, '.ai-spec', 'skills', 'a-skill');
      const skillBDir = join(projectRoot, '.ai-spec', 'skills', 'b-skill');
      mkdirSync(join(skillADir, 'templates'), { recursive: true });
      mkdirSync(join(skillBDir, 'templates'), { recursive: true });
      writeFileSync(
        join(skillADir, 'skill.yaml'),
        `package:
  name: 'a-skill'
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
  name: 'b-skill'
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

      const indexPath = join(projectRoot, '.ai-spec', 'skills', 'installed.json');
      writeFileSync(
        indexPath,
        JSON.stringify(
          [
            {
              name: 'a-skill',
              version: '0.1.0',
              installed_at: new Date().toISOString(),
              install_path: skillADir,
              source: 'local',
            },
            {
              name: 'b-skill',
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
      const result = composer.compose(['a-skill', 'b-skill']);
      expect(result.errors.some((e) => e.includes('隐式模板覆盖'))).toBe(true);
    } finally {
      teardown();
    }
  });
});
