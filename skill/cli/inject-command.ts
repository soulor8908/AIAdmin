// cli/inject-command.ts —— ai-spec inject 子命令
// P2 主入口：探测 → 分析 → 逆向契约 → 注入计划 → 执行 → 安全网
//
// 用法：
//   ai-spec inject                              # 全流程交互
//   ai-spec inject --dry-run                     # 只生成计划，不写入
//   ai-spec inject --no-safety-net               # 跳过测试安全网
//   ai-spec inject --severity advisory           # 指定默认级别
//   ai-spec inject --gate-up ARCH-001:warning    # 升级规则级别
//   ai-spec rollback                             # 回滚最近一次注入

import { Command } from 'commander';
import { detectProject, detectAndWriteProfile } from '../inject/detector/detector.js';
import { analyzeArchitecture } from '../inject/arch-analyzer/analyzer.js';
import { reverseApi } from '../inject/contract-reverser/reverser.js';
import { planInjection, executeInjection, rollbackInjection, gateUp } from '../inject/rule-injector/injector.js';
import { captureBaseline, compareAfter, loadBaseline } from '../inject/safety-net/runner.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './log.js';
import type { InjectionConfig, SeverityLevel } from '../inject/rule-injector/types.js';

export function registerInjectCommand(program: Command): void {
  const inject = program
    .command('inject')
    .description('对既有项目注入 spec-first 基础设施')
    .option('--dry-run', '只生成计划，不写入', false)
    .option('--severity <level>', '默认级别 (advisory|warning|blocking)', 'advisory')
    .option('--no-safety-net', '跳过测试安全网', false)
    .option('--no-analyze', '跳过架构分析', false)
    .option('--no-reverse', '跳过 API 逆向', false)
    .action(async (cmdOpts: Record<string, unknown>) => {
      await runInject(cmdOpts);
    });

  // gate-up 子命令
  program
    .command('gate-up <ruleId:level>')
    .description('升级规则级别（advisory → warning → blocking），如 ARCH-001:warning')
    .action(async (arg: string) => {
      await runGateUp(arg);
    });

  // rollback 子命令
  program
    .command('rollback')
    .description('回滚最近一次 inject')
    .action(async () => {
      await runRollback();
    });
}

async function runInject(cmdOpts: Record<string, unknown>): Promise<void> {
  const rootDir = process.cwd();
  const dryRun = cmdOpts.dryRun === true;
  const noSafetyNet = cmdOpts.safetyNet === false;
  const noAnalyze = cmdOpts.analyze === false;
  const noReverse = cmdOpts.reverse === false;
  const severity = (cmdOpts.severity as SeverityLevel) ?? 'advisory';

  logger.banner();
  logger.info(`目标目录：${rootDir}`);
  logger.info(`模式：${dryRun ? 'dry-run（仅计划）' : '执行（写入 + 备份）'}`);

  // 1. 探测
  logger.startStep('探测项目技术栈');
  const { profile, written_to } = detectAndWriteProfile(rootDir);
  logger.endStep('探测项目技术栈', true);
  logger.info(`语言：${profile.language}${profile.language_version ? ' (' + profile.language_version + ')' : ''}`);
  if (profile.backend) logger.info(`后端：${profile.backend.label} (置信度 ${profile.backend.confidence})`);
  if (profile.frontend) logger.info(`前端：${profile.frontend.label}`);
  if (profile.db) logger.info(`数据库：${profile.db.label}`);
  if (profile.orm) logger.info(`ORM：${profile.orm.label}`);
  if (profile.test_runner) logger.info(`测试：${profile.test_runner.label}`);
  if (profile.ci) logger.info(`CI：${profile.ci.label}`);
  if (profile.warnings.length > 0) {
    for (const w of profile.warnings) logger.warn(w);
  }

  // 2. 架构分析
  if (!noAnalyze) {
    logger.startStep('分析架构分层');
    const arch = analyzeArchitecture(rootDir, profile);
    const archDir = join(rootDir, '.ai-spec');
    if (!existsSync(archDir)) mkdirSync(archDir, { recursive: true });
    writeFileSync(join(archDir, 'architecture-report.md'), arch.markdown_report);
    writeFileSync(join(archDir, 'architecture-report.json'), JSON.stringify(arch, null, 2) + '\n');
    logger.endStep(`分析架构分层 (${arch.layers.length} 层, ${arch.violations.length} 违规)`, true);
    if (arch.violations.length > 0) {
      for (const v of arch.violations.slice(0, 5)) {
        logger.warn(`${v.kind}: ${v.message}`);
      }
      if (arch.violations.length > 5) logger.warn(`... 还有 ${arch.violations.length - 5} 个违规`);
    }
  }

  // 3. API 逆向
  if (!noReverse) {
    logger.startStep('逆向生成 API 契约');
    const reverse = reverseApi(rootDir, profile);
    if (reverse.endpoints.length > 0) {
      const revDir = join(rootDir, '.ai-spec');
      writeFileSync(join(revDir, 'openapi.json'), JSON.stringify(reverse.openapi, null, 2) + '\n');
      writeFileSync(join(revDir, 'api-contract-report.md'), reverse.markdown_report);
    }
    logger.endStep(`逆向生成 API 契约 (${reverse.endpoints.length} 端点)`, true);
    if (reverse.warnings.length > 0) {
      for (const w of reverse.warnings) logger.warn(w);
    }
  }

  // 4. 安全网 baseline（注入前）
  let baseline = undefined;
  if (!noSafetyNet && !dryRun) {
    logger.startStep('捕获测试 baseline');
    try {
      baseline = loadBaseline(rootDir) ?? captureBaseline(rootDir, profile);
      logger.endStep(`捕获测试 baseline (退出码 ${baseline.exit_code}, 失败 ${baseline.failed ?? 0})`, true);
    } catch (e) {
      logger.endStep('捕获测试 baseline', false);
      logger.warn(`baseline 失败：${(e as Error).message}`);
    }
  }

  // 5. 注入计划
  logger.startStep('生成注入计划');
  const config: InjectionConfig = {
    out_dir: '.ai-spec',
    default_level: severity,
    overrides: {},
    dry_run: dryRun,
  };
  const plan = planInjection(rootDir, profile, config);
  // 写入计划到 .ai-spec/inject-plan.md
  const planDir = join(rootDir, '.ai-spec');
  if (!existsSync(planDir)) mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'inject-plan.md'), plan.markdown);
  logger.endStep(
    `生成注入计划 (${plan.impact.new_files} 新建 + ${plan.impact.modified_files} 修改)`,
    true,
  );

  // 6. 执行（非 dry-run）
  if (!dryRun) {
    logger.startStep('执行注入');
    const result = executeInjection(rootDir, plan);
    logger.endStep(`执行注入 (${result.written} 文件, ${result.backups.length} 备份)`, true);

    // 7. 安全网 after + 对比
    if (!noSafetyNet && baseline) {
      logger.startStep('对比测试 after');
      try {
        const report = compareAfter(rootDir, profile, baseline);
        logger.endStep(
          `对比测试 after (新增失败 ${report.new_failures.length}, baseline ${report.baseline.failed ?? 0} → after ${report.after.failed ?? 0})`,
          report.new_failures.length === 0,
        );
        if (report.new_failures.length > 0) {
          for (const f of report.new_failures) logger.error(f);
        }
      } catch (e) {
        logger.endStep('对比测试 after', false);
        logger.warn(`after 失败：${(e as Error).message}`);
      }
    }

    logger.blank();
    logger.success('注入完成！');
    logger.info(`计划：${planDir}/inject-plan.md`);
    logger.info(`回滚：ai-spec rollback`);
  } else {
    logger.blank();
    logger.success('dry-run 计划已生成');
    logger.info(`查看：${planDir}/inject-plan.md`);
    logger.info(`执行：去掉 --dry-run 重跑`);
  }
}

async function runGateUp(arg: string): Promise<void> {
  const rootDir = process.cwd();
  const [ruleId, levelStr] = arg.split(':');
  if (!ruleId || !levelStr) {
    logger.error('参数格式：<ruleId>:<level>，如 ARCH-001:warning');
    process.exit(1);
  }
  const level = levelStr as SeverityLevel;
  if (!['advisory', 'warning', 'blocking'].includes(level)) {
    logger.error(`级别不合法：${level}（可选 advisory|warning|blocking）`);
    process.exit(1);
  }
  try {
    const result = gateUp(rootDir, ruleId, level);
    logger.success(`规则 ${ruleId} 升级：${result.old_level} → ${result.new_level}`);
    logger.info(`文件：${result.rule_file}`);
  } catch (e) {
    logger.error(`升级失败：${(e as Error).message}`);
    process.exit(1);
  }
}

async function runRollback(): Promise<void> {
  const rootDir = process.cwd();
  try {
    const result = rollbackInjection(rootDir);
    logger.success(`回滚完成：${result.rolled_back} 文件已恢复`);
    logger.info(`备份目录：${result.backup_dir}`);
  } catch (e) {
    logger.error(`回滚失败：${(e as Error).message}`);
    process.exit(1);
  }
}
