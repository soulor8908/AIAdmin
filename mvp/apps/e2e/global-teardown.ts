// apps/e2e/global-teardown.ts —— R20 E2E 临时 DB 清理（TECH-E2E-INTRODUCTION-001 §3.3 策略 A）
//
// 职责：E2E 全部 test 跑完后，删除 webServer env 注入的临时 DB 文件（os.tmpdir() 下）。
// 设计要点：
// - globalTeardown 在 Playwright 主进程执行（非 webServer 子进程），通过 process.env.E2E_DB_PATH
//   读临时 DB 路径（playwright.config.ts 顶层赋值，config → teardown 同进程可见）。
// - 文件不存在时静默跳过（不抛错，幂等清理，兼容 server 未成功启动 / 文件已被 OS 清理的场景）。
// - 仅删 .db 文件本身（不删 -wal/-shm 侧车文件，node:sqlite 默认 WAL 模式但 server 关闭时已 checkpoint）。
import { unlinkSync } from 'node:fs';

/** globalTeardown：删除临时 DB 文件（§3.3 策略 A，干净清理）。 */
export default function globalTeardown(): void {
  const dbPath = process.env.E2E_DB_PATH;
  if (!dbPath) {
    // 未注入 DB_PATH（异常场景，如 config 被改），静默跳过。
    return;
  }
  try {
    unlinkSync(dbPath);
  } catch (err: unknown) {
    // 文件不存在（ENOENT）静默跳过；其他错误打印警告但不阻断 teardown。
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[E2E globalTeardown] 删除临时 DB 失败 (${dbPath}):`, err);
    }
  }
}
