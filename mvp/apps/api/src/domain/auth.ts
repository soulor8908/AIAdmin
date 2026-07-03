// apps/api/src/domain/auth.ts —— 领域层：token 签发/验签 + 密码哈希（纯函数，无 IO）
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts。
// 派生自 Tech-Spec TECH-AUTH-001 D1（HMAC-SHA256 不透明 token）/ D2（scrypt salt.hash）。
// [约束] D1：token = base64url(payload_json) + '.' + base64url(HMAC-SHA256(payload_json, AUTH_SECRET))。
// [约束] D2：password_hash = <salt_b64>.<hash_b64>（scryptSync，keylen=64，timingSafeEqual 常量时间比对）。
// [advisory] D2 分隔符用 '.'（Spec 调整，PRD 草图为 ':'）；scryptSync 同步阻塞（MVP 可接受）。
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { tokenPayloadSchema, type TokenPayload } from '@admin/contracts';

/** token 有效期（秒），PRD Q6 决策①：1 小时。signToken 时 exp = iat + TOKEN_TTL_SECONDS。 */
export const TOKEN_TTL_SECONDS = 3600;

/**
 * 签发不透明 token（D1）。
 * token = base64url(payload_json) + '.' + base64url(HMAC-SHA256(payload_json, secret))。
 * 客户端不解析 payload；服务端用 HMAC 验签防伪造（语义对齐 JWT 但不引入 JWT 库，零新依赖）。
 */
export function signToken(payload: TokenPayload, secret: string): string {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

/**
 * 验签并解析 token（D1 / D8 G3）。
 * [约束] 仅做签名验证 + payload 结构解析；**不检查过期**（exp 判定 G4 由 buildCtx 中间件负责，
 *   见 auth.test.ts「verifyToken 不检查过期」断言：过期但签名有效的 token → ok:true）。
 * [约束] 验签失败/格式错/payload 非法 → { ok: false, errorCode: 'TOKEN_INVALID' }（单码覆盖，D9）。
 * @returns ok=true 携带 payload；ok=false 携带 errorCode='TOKEN_INVALID'
 */
export function verifyToken(
  token: string,
  secret: string,
): { ok: true; payload: TokenPayload } | { ok: false; errorCode: 'TOKEN_INVALID' } {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, errorCode: 'TOKEN_INVALID' };
  const payloadB64 = parts[0];
  const sig = parts[1];
  if (!payloadB64 || !sig) return { ok: false, errorCode: 'TOKEN_INVALID' };
  const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  // 常量时间比对（防时序攻击）：长度不等直接失败，否则 timingSafeEqual
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, errorCode: 'TOKEN_INVALID' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, errorCode: 'TOKEN_INVALID' };
  }
  const result = tokenPayloadSchema.safeParse(parsed);
  if (!result.success) return { ok: false, errorCode: 'TOKEN_INVALID' };
  return { ok: true, payload: result.data };
}

/**
 * 密码哈希（D2 scrypt）：返回 `<salt_b64>.<hash_b64>` 格式。
 * [约束] salt = randomBytes(16)；hash = scryptSync(password, salt, 64)（OWASP 推荐，默认 N/r/p）。
 * [约束] 每次产生不同 salt（相同密码 → 不同 hash）。
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('base64')}.${hash.toString('base64')}`;
}

/**
 * 密码校验（D2）：解析 salt.hash，scryptSync 重算，timingSafeEqual 常量时间比对。
 * [约束] 格式错误（无点分隔 / base64 解码失败 / 长度不等）→ false（不抛错）。
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('.');
  if (parts.length !== 2) return false;
  const saltB64 = parts[0];
  const hashB64 = parts[1];
  if (!saltB64 || !hashB64) return false;
  let salt: Buffer;
  let storedHash: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    storedHash = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  const hash = scryptSync(password, salt, 64);
  if (hash.length !== storedHash.length) return false;
  return timingSafeEqual(hash, storedHash);
}

/**
 * 生成 12 位临时密码（D6：createUser 缺省 password 时调用）。
 * randomBytes → base64 取前 12 字符（9 字节 base64 编码恰为 12 字符）。
 */
export function generateTempPassword(): string {
  return randomBytes(9).toString('base64').slice(0, 12);
}
