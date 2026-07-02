// apps/api/src/etag.ts —— ETag 协商缓存 HTTP 层工具（TECH-ETAG-CACHING-001 D7/D8）
//
// [advisory] 本文件为 HTTP 层工具模块（与 server.ts 同层——src/ 根目录，layerOf 返回 null，
//   不受 ARCH-001 四层反向依赖约束）。ETag 生成是 HTTP header 格式化，非领域逻辑（D2），
//   不放 domain（domain 不感知 HTTP）；不放 server.ts 内部（server.ts 有 listen 副作用，
//   测试不可直接 import，提取到独立模块便于单测）。
//
// 设计：
// - detailEtag：基于实体 version 生成强 ETag（"version" 引号包裹，RFC 7232）。
// - listEtag：基于结果集 total-maxVersion 组合键生成（Q5 决策②）。
// - parseIfNoneMatch：宽容解析 If-None-Match header（Q7 决策①，缺失/非法→null 忽略，非错误）。
// - 与 R9 parseIfMatch（严格解析）形成对比：写条件严格 / 读条件宽容。

/**
 * 从 GET detail 响应实体生成强 ETag（TECH-ETAG-CACHING-001 D7）。
 * 格式：`"${version}"`（双引号包裹 version 数字，RFC 7232 强 ETag，Q2 决策①）。
 * 复用 R9 version 字段（Q1 决策①），update 后 version 递增 → ETag 自动变化。
 * @param result handler 返回值（实体对象，含 version 字段）
 * @returns ETag 字符串（含引号，如 "0" / "5"）；version 缺失回退 "0"
 */
export function detailEtag(result: unknown): string {
  const r = result as { version?: unknown };
  if (typeof r?.version !== 'number' || !Number.isFinite(r.version)) return '"0"';
  return `"${r.version}"`;
}

/**
 * 从 GET list 响应结果集生成强 ETag（TECH-ETAG-CACHING-001 D7）。
 * 格式：`"${total}-${maxVersion}"`（组合键，Q5 决策②）。
 * create 触发 total 变化 / update 触发 maxVersion 变化 / delete 触发 total 变化，覆盖主要变更场景。
 * @param result handler 返回值（{items, total} 结构，items 各项含 version）
 * @returns ETag 字符串（含引号，如 "3-5"）；total/items 缺失回退 "0-0"
 */
export function listEtag(result: unknown): string {
  const r = result as { total?: unknown; items?: unknown };
  // total 缺失/非法 → 结果集结构不完整，整个 ETag 回退默认值 "0-0"（不计算 maxVersion）
  if (typeof r?.total !== 'number' || !Number.isFinite(r.total)) return '"0-0"';
  const total = r.total;
  const items = Array.isArray(r?.items) ? r.items : [];
  let maxVersion = 0;
  for (const item of items) {
    const v = (item as { version?: unknown })?.version;
    if (typeof v === 'number' && Number.isFinite(v) && v > maxVersion) maxVersion = v;
  }
  return `"${total}-${maxVersion}"`;
}

/**
 * 解析 If-None-Match header 为 ETag（TECH-ETAG-CACHING-001 D8）。
 * 接受 RFC 7232 强 ETag 引号格式（如 "0" / "3-5"）。
 * [约束] Q7 决策①宽容解析：缺失/格式非法 → 返回 null（忽略 header，返回 200），非错误。
 *   与 R9 parseIfMatch 严格解析形成对比——写条件严格（缺失→VERSION_REQUIRED 400）/ 读条件宽容（缺失/非法→忽略 200）。
 * @param headerValue If-None-Match header 原始值
 * @returns ETag 字符串（含引号）或 null（缺失/格式非法，忽略）
 */
export function parseIfNoneMatch(headerValue: string | undefined): string | null {
  if (headerValue === undefined || headerValue.trim() === '') return null;
  const trimmed = headerValue.trim();
  // RFC 7232 强 ETag：双引号包裹（允许内部含除引号外字符）
  if (!/^"[^"]*"$/.test(trimmed)) return null;
  return trimmed;
}
