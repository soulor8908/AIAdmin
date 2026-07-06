// registry/registry.ts —— P3-2 Skill Registry 本地实现
// 维护项目级 .ai-spec/skills/installed.json 索引 + 内置 skills 目录。
//
// 操作：
// - list：列出所有已安装 + 内置 skill
// - search <keyword>：按名称/关键词搜索（本地 + 内置）
// - add <name>：把内置 skill 复制到项目 .ai-spec/skills/，写入索引
// - update <name>：从内置目录重新同步到项目
// - remove <name>：删除项目级副本 + 从索引移除
//
// 设计：
// - 本地目录索引（无 HTTP 服务），适合 MVP 与 CI
// - installed.json 是 SSOT，记录 name/version/installed_at/path/source
// - builtin skills 来自 skill/skills/（由 discoverSkills 加载）

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSkills, defaultBuiltinSkillsDir, loadSkillFull } from '../skill-pkg/loader.js';
import type { LoadedSkill, InstalledSkill } from '../skill-pkg/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 项目级安装索引路径（相对项目根） */
const INSTALLED_INDEX_REL = '.ai-spec/skills/installed.json';

/** 项目级 skills 安装目录（相对项目根） */
const INSTALLED_DIR_REL = '.ai-spec/skills';

export interface RegistryListEntry {
  name: string;
  version: string;
  description: string;
  category: string;
  source: 'builtin' | 'local' | 'remote';
  installed_at?: string;
}

export interface SearchResult {
  query: string;
  matches: Array<{ name: string; version: string; description: string; score: number }>;
}

export class LocalRegistry {
  constructor(
    private readonly projectRoot: string,
    private readonly builtinDir: string = defaultBuiltinSkillsDir(),
  ) {}

  /** 列出所有可用 skill：已安装 + 内置未安装 */
  list(): RegistryListEntry[] {
    const installed = this.readInstalledIndex();
    const builtin = this.listBuiltin();
    const entries: RegistryListEntry[] = [];

    // 已安装
    for (const inst of installed) {
      const loaded = this.loadFromDir(inst.install_path);
      entries.push({
        name: inst.name,
        version: inst.version,
        description: loaded?.manifest.package.description ?? '',
        category: loaded?.manifest.package.category ?? 'domain',
        source: inst.source,
        installed_at: inst.installed_at,
      });
    }

    // 内置未安装（去重）
    const installedNames = new Set(installed.map((i) => i.name));
    for (const b of builtin) {
      if (!installedNames.has(b.manifest.package.name)) {
        entries.push({
          name: b.manifest.package.name,
          version: b.manifest.package.version,
          description: b.manifest.package.description,
          category: b.manifest.package.category,
          source: 'builtin',
        });
      }
    }

    return entries;
  }

  /** 关键词搜索 */
  search(keyword: string): SearchResult {
    const kw = keyword.toLowerCase();
    const all = this.list();
    const matches = all
      .map((e) => {
        const score = scoreMatch(e, kw);
        return { name: e.name, version: e.version, description: e.description, score };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score);
    return { query: keyword, matches };
  }

  /** 安装：从 builtin 复制到项目级 */
  add(name: string): { installed: InstalledSkill; warnings: string[] } {
    const warnings: string[] = [];
    const builtin = this.listBuiltin().find((s) => s.manifest.package.name === name);
    if (!builtin) {
      throw new Error(`内置 skill 未找到：${name}`);
    }

    const installedDir = join(this.projectRoot, INSTALLED_DIR_REL, name.replace(/[@/]/g, '_'));
    if (existsSync(installedDir)) {
      rmSync(installedDir, { recursive: true, force: true });
    }
    mkdirSync(installedDir, { recursive: true });
    copyDirRecursive(builtin.manifest.skill_dir, installedDir);

    const installed: InstalledSkill = {
      name,
      version: builtin.manifest.package.version,
      installed_at: new Date().toISOString(),
      install_path: installedDir,
      source: 'local',
    };

    const index = this.readInstalledIndex().filter((i) => i.name !== name);
    index.push(installed);
    this.writeInstalledIndex(index);

    return { installed, warnings };
  }

  /** 更新：重新从 builtin 同步 */
  update(name: string): { updated: InstalledSkill } {
    return { updated: this.add(name).installed };
  }

  /** 卸载 */
  remove(name: string): { removed: boolean } {
    const index = this.readInstalledIndex();
    const entry = index.find((i) => i.name === name);
    if (!entry) return { removed: false };
    if (existsSync(entry.install_path)) {
      rmSync(entry.install_path, { recursive: true, force: true });
    }
    this.writeInstalledIndex(index.filter((i) => i.name !== name));
    return { removed: true };
  }

  /** 获取已安装的某个 skill（LoadedSkill 形式） */
  getInstalled(name: string): LoadedSkill | undefined {
    const index = this.readInstalledIndex();
    const entry = index.find((i) => i.name === name);
    if (!entry) return undefined;
    return this.loadFromDir(entry.install_path);
  }

  /** 列出所有已安装的 LoadedSkill（供 composer 用） */
  listInstalledLoaded(): LoadedSkill[] {
    const index = this.readInstalledIndex();
    const loaded: LoadedSkill[] = [];
    for (const entry of index) {
      const l = this.loadFromDir(entry.install_path);
      if (l) loaded.push(l);
    }
    return loaded;
  }

  // ============ 内部 ============

  private listBuiltin(): LoadedSkill[] {
    const { skills, logs } = discoverSkills(this.builtinDir);
    if (logs.length > 0 && process.env.AI_SPEC_DEBUG) {
      // 仅在 debug 模式打印
      for (const l of logs) console.error(`[registry] ${l}`);
    }
    return skills;
  }

  private loadFromDir(dir: string): LoadedSkill | undefined {
    if (!existsSync(dir)) return undefined;
    const result = loadSkillFull(dir);
    return result.loaded;
  }

  private readInstalledIndex(): InstalledSkill[] {
    const path = join(this.projectRoot, INSTALLED_INDEX_REL);
    if (!existsSync(path)) return [];
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return [];
    }
  }

  private writeInstalledIndex(index: InstalledSkill[]): void {
    const path = join(this.projectRoot, INSTALLED_INDEX_REL);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(index, null, 2) + '\n');
  }
}

// ============ 工具 ============

function scoreMatch(entry: RegistryListEntry, keywordLower: string): number {
  let score = 0;
  if (entry.name.toLowerCase().includes(keywordLower)) score += 10;
  if (entry.description.toLowerCase().includes(keywordLower)) score += 5;
  if (entry.category.toLowerCase() === keywordLower) score += 3;
  return score;
}

function copyDirRecursive(src: string, dest: string): void {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const srcPath = join(src, name);
    const destPath = join(dest, name);
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
