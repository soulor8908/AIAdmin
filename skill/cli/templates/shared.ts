// cli/templates/shared.ts —— 模板渲染共享工具
// 问题 5：从 template-engine.ts 拆出，供各 templates/* 复用。

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GenerateOptions } from '../options.js';
import type { WriteOp } from '../../spi/adapter.js';

export const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 包名规范化：小写 + 仅允许 [a-z0-9-]。
 */
export function normalizePkgName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * 从适配器目录加载模板文件。
 * 路径：adapters/<type>/<id>/files/<fileName>
 * 失败时抛错（适配器缺失是开发期问题，不应静默回退，建议 1）。
 *
 * 注意：本文件位于 cli/templates/，向上一级到 cli/，再向上一级到 skill/，再进入 adapters/。
 */
export function loadAdapterFileOrThrow(type: string, id: string, fileName: string): string {
  const path = join(__dirname, '..', '..', 'adapters', type, id, 'files', fileName);
  if (!existsSync(path)) {
    throw new Error(`适配器模板缺失：adapters/${type}/${id}/files/${fileName}（experimental 适配器防护，建议 1）`);
  }
  return readFileSync(path, 'utf8');
}

/** 旧别名：保持向后兼容 */
export const loadAdapterFile = loadAdapterFileOrThrow;

/**
 * 检查适配器文件是否存在（不抛错）。
 */
export function adapterFileExists(type: string, id: string, fileName: string): boolean {
  const path = join(__dirname, '..', '..', 'adapters', type, id, 'files', fileName);
  return existsSync(path);
}

/**
 * 渲染适配器模板：替换 {{var}} 占位符。
 * 当前实现最小化（只替换 project-name），未来可扩展为 handlebars。
 *
 * 建议 4：渲染后校验，无 {{...}} 残留（在 renderProject 末尾统一检测）。
 */
export function renderAdapterTemplate(template: string, opts: GenerateOptions): string {
  let result = template;
  result = result.replace(/\{\{project-name\}\}/g, opts.project_name);
  result = result.replace(/\{\{project_name\}\}/g, opts.project_name);
  return result;
}

/**
 * 递归拷贝目录为 WriteOp 清单（用于从 kernel/ 拷贝规则/角色/模板到生成项目的 .ai-spec/）。
 */
export function walkCopy(srcDir: string, destDir: string): WriteOp[] {
  const ops: WriteOp[] = [];
  for (const name of readdirSync(srcDir)) {
    const src = join(srcDir, name);
    const dest = join(destDir, name);
    if (statSync(src).isDirectory()) {
      ops.push(...walkCopy(src, dest));
    } else {
      ops.push({
        path: dest,
        content: readFileSync(src, 'utf8'),
        is_new: true,
        reason: `kernel/${destDir}/${name}`,
      });
    }
  }
  return ops;
}
