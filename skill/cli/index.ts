#!/usr/bin/env node
// cli/index.ts —— create-ai-spec-app CLI 主入口
// P1-1 产出：commander 命令解析 + enquirer 交互 prompt 双模式。
//
// 用法：
//   交互式：  npx create-ai-spec-app my-project
//   非交互式：npx create-ai-spec-app my-project --backend fastify-ts --db postgresql --yes
//   黄金组合：npx create-ai-spec-app my-project --yes

import { Command } from 'commander';
import { promptStack, promptConfirm } from './prompts.js';
import { generateProject } from './generate.js';
import { validateOptions, GOLDEN_COMBO, type GenerateOptions, type StackSelection } from './options.js';
import { logger } from './log.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerInjectCommand } from './inject-command.js';
import { registerSkillCommand } from './skill-command.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function readVersion(): Promise<string> {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    return pkg.version ?? '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

async function main(): Promise<void> {
  const version = await readVersion();
  const program = new Command();

  program
    .name('create-ai-spec-app')
    .description('spec-first AI 原生工作流脚手架')
    .version(version, '-V, --version')
    .argument('[project-name]', '项目名（用作目录名）')
    .option('-o, --out <dir>', '输出目录（默认 ./<project-name>）')
    .option('-b, --backend <stack>', '后端技术栈 (fastify-ts|express-ts|spring-boot|fastapi)')
    .option('-d, --db <db>', '数据库 (postgresql|sqlite|mysql|mongodb)')
    .option('-f, --frontend <stack>', '前端技术栈 (react-vite|vue3-vite|angular|none)')
    .option('-c, --contract <lib>', '契约库 (zod|pydantic|json-schema)')
    .option('-a, --auth <scheme>', '认证方案 (jwt|session|oauth2|none)')
    .option('--ci <platform>', 'CI 平台 (github-actions|gitlab-ci|none)')
    .option('-y, --yes', '使用黄金组合默认值（非交互模式）', false)
    .option('--no-deps', '跳过依赖安装')
    .option('--no-git', '跳过 git init')
    .option('-v, --verbose', '详细日志', false)
    .action(async (projectName: string | undefined, cmdOpts: Record<string, unknown>) => {
      await runGenerate(projectName, cmdOpts);
    });

  // Phase 2：注册 inject / gate-up / rollback 子命令
  registerInjectCommand(program);

  // Phase 3：注册 skill 子命令（list / search / add / update / remove）
  registerSkillCommand(program);

  await program.parseAsync(process.argv);
}

async function runGenerate(projectName: string | undefined, cmdOpts: Record<string, unknown>): Promise<void> {
  logger.banner();

  // 1. 校验项目名
  if (!projectName) {
    logger.error('缺少项目名：create-ai-spec-app <project-name>');
    process.exit(1);
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(projectName)) {
    logger.error(`项目名 "${projectName}" 不合法（须以字母开头，仅含字母数字下划线连字符）`);
    process.exit(1);
  }

  // 2. 收集 stack 选择
  const cmdStack: Partial<StackSelection> = {};
  if (cmdOpts.backend) cmdStack.backend = cmdOpts.backend as string;
  if (cmdOpts.db) cmdStack.db = cmdOpts.db as string;
  if (cmdOpts.frontend) cmdStack.frontend = cmdOpts.frontend as string;
  if (cmdOpts.contract) cmdStack.contract = cmdOpts.contract as string;
  if (cmdOpts.auth) cmdStack.auth = cmdOpts.auth as string;
  if (cmdOpts.ci) cmdStack.ci = cmdOpts.ci as string;

  const yes = cmdOpts.yes === true;
  // --yes 模式：仅在缺省字段用 GOLDEN_COMBO 填充，不覆盖显式传值
  const stack: StackSelection = yes
    ? { ...GOLDEN_COMBO, ...cmdStack }
    : await resolveStackInteractive(cmdStack);

  if (yes) {
    const isGolden = JSON.stringify(stack) === JSON.stringify(GOLDEN_COMBO);
    logger.info(
      isGolden
        ? `使用黄金组合：${stack.backend} + ${stack.db} + ${stack.frontend}`
        : `使用定制组合：${stack.backend} + ${stack.db} + ${stack.frontend}（--yes 模式补齐缺省字段）`,
    );
  }

  // 3. 校验 + 推断默认值
  const opts: Partial<GenerateOptions> = {
    project_name: projectName,
    out_dir: (cmdOpts.out as string) ?? `./${projectName}`,
    stack,
    no_deps: cmdOpts.deps === false,
    no_git: cmdOpts.git === false,
    yes,
    verbose: cmdOpts.verbose === true,
  };

  const { errors, warnings, inferred } = validateOptions(opts);
  if (errors.length > 0) {
    logger.error('选项校验失败：');
    for (const e of errors) logger.error(`  - ${e}`);
    process.exit(1);
  }
  for (const w of warnings) logger.warn(w);

  opts.stack = inferred;

  // 4. 交互式确认（非 --yes 模式）
  if (!yes) {
    const ok = await promptConfirm(projectName, opts.stack!);
    if (!ok) {
      logger.warn('已取消');
      process.exit(0);
    }
  }

  // 5. 生成
  try {
    const result = await generateProject(opts as GenerateOptions);
    logger.blank();
    logger.success(`项目 ${projectName} 已创建！`);
    logger.blank();
    logger.info(`位置：${result.out_dir}`);
    logger.info(`文件：${result.files_written} 个`);
    if (result.deps_installed) logger.info('依赖：已安装');
    if (result.git_inited) logger.info('Git：已初始化');
    for (const w of result.warnings) logger.warn(w);
    logger.blank();
    logger.info('下一步：');
    for (const step of result.next_steps) {
      logger.info(`  ${step}`);
    }
  } catch (e) {
    logger.error(`生成失败：${(e as Error).message}`);
    if (cmdOpts.verbose) {
      console.error(e);
    }
    process.exit(1);
  }
}

async function resolveStackInteractive(initial: Partial<StackSelection>): Promise<StackSelection> {
  logger.info('未指定 --yes，进入交互模式（Ctrl+C 退出）');
  return await promptStack(initial);
}

main().catch((e) => {
  logger.error(`未捕获异常：${(e as Error).message}`);
  process.exit(1);
});
