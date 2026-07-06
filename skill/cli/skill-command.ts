// cli/skill-command.ts —— ai-spec skill 子命令
// P3-2 CLI：list / search / add / update / remove
//
// 用法：
//   ai-spec skill list
//   ai-spec skill search <keyword>
//   ai-spec skill add <name>
//   ai-spec skill update <name>
//   ai-spec skill remove <name>

import { Command } from 'commander';
import { LocalRegistry } from '../registry/registry.js';
import { logger } from './log.js';

export function registerSkillCommand(program: Command): void {
  const skill = program
    .command('skill')
    .description('Skill 包管理（list / search / add / update / remove）');

  skill
    .command('list')
    .description('列出所有可用 skill（已安装 + 内置）')
    .action(() => {
      const registry = new LocalRegistry(process.cwd());
      const entries = registry.list();
      if (entries.length === 0) {
        logger.info('（无可用 skill）');
        return;
      }
      logger.info(`共 ${entries.length} 个 skill：`);
      for (const e of entries) {
        const src = e.source === 'builtin' ? '[builtin]' : '[installed]';
        const ts = e.installed_at ? ` (installed: ${e.installed_at.slice(0, 10)})` : '';
        logger.info(`  ${src} ${e.name}@${e.version}${ts}`);
        if (e.description) logger.info(`         ${e.description}`);
      }
    });

  skill
    .command('search <keyword>')
    .description('按关键词搜索 skill')
    .action((keyword: string) => {
      const registry = new LocalRegistry(process.cwd());
      const result = registry.search(keyword);
      if (result.matches.length === 0) {
        logger.warn(`未找到匹配 "${keyword}" 的 skill`);
        return;
      }
      logger.info(`找到 ${result.matches.length} 个匹配：`);
      for (const m of result.matches) {
        logger.info(`  ${m.name}@${m.version} (score: ${m.score})`);
        if (m.description) logger.info(`         ${m.description}`);
      }
    });

  skill
    .command('add <name>')
    .description('安装 skill 到当前项目')
    .action((name: string) => {
      const registry = new LocalRegistry(process.cwd());
      try {
        const { installed, warnings } = registry.add(name);
        logger.success(`已安装：${installed.name}@${installed.version}`);
        logger.info(`路径：${installed.install_path}`);
        for (const w of warnings) logger.warn(w);
      } catch (e) {
        logger.error(`安装失败：${(e as Error).message}`);
        process.exit(1);
      }
    });

  skill
    .command('update <name>')
    .description('更新 skill（从内置重新同步）')
    .action((name: string) => {
      const registry = new LocalRegistry(process.cwd());
      try {
        const { updated } = registry.update(name);
        logger.success(`已更新：${updated.name}@${updated.version}`);
      } catch (e) {
        logger.error(`更新失败：${(e as Error).message}`);
        process.exit(1);
      }
    });

  skill
    .command('remove <name>')
    .description('卸载 skill')
    .action((name: string) => {
      const registry = new LocalRegistry(process.cwd());
      const { removed } = registry.remove(name);
      if (removed) {
        logger.success(`已卸载：${name}`);
      } else {
        logger.warn(`未安装：${name}`);
      }
    });
}
