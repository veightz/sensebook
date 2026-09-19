import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

const seconds = () => Math.floor(Date.now() / 1000);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
export const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('');
const cookie = (c, name) => (c.req.header('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
const setCookie = (c, name, value, age) => c.header('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${name === '__Host-sb_session' ? 'Lax' : 'Strict'}; Max-Age=${age}`, { append: true });
const origin = c => {
  const url = new URL(c.req.url);
  // 固定生产域名，不能根据任意 Host 自动接受新的 RP。
  const expected = c.env.PASSKEY_ORIGIN;
  if (!expected || url.origin !== expected || !expected.startsWith('https://')) throw fail('本站尚未配置 Passkey', 503);
  return { expectedOrigin: expected, expectedRPID: new URL(expected).hostname };
};
export async function sessionIdentity(c) {
  const token = cookie(c, '__Host-sb_session');
  if (!token) return null;
  const row = await c.env.DB.prepare('SELECT s.*,u.email FROM web_sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>? AND (s.credential_id IS NULL OR EXISTS (SELECT 1 FROM passkeys p WHERE p.id=s.credential_id AND p.revoked_at IS NULL))').bind(await hash(token), seconds()).first();
  if (!row || row.email.toLowerCase() !== (c.env.OWNER_EMAIL || '').toLowerCase()) throw fail('登录已过期，请重新登录', 401);
  return { id: row.user_id, email: row.email, authAt: row.auth_at };
}
export async function createSession(c, user, credential = null) {
  const token = random();
  await c.env.DB.prepare('INSERT INTO users(id,email,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(user.id, user.email, new Date().toISOString()).run();
  await c.env.DB.prepare('INSERT INTO web_sessions(token_hash,user_id,credential_id,auth_at,expires_at) VALUES (?,?,?,?,?)').bind(await hash(token), user.id, credential, user.authAt ?? seconds(), seconds() + 86400).run();
  setCookie(c, '__Host-sb_session', token, 86400);
}
export async function endSession(c) {
  const token = cookie(c, '__Host-sb_session');
  if (token) await c.env.DB.prepare('DELETE FROM web_sessions WHERE token_hash=?').bind(await hash(token)).run();
  setCookie(c, '__Host-sb_session', '', 0);
}
async function limited(c) {
  const time = seconds(), bucket = Math.floor(time / 300);
  const id = await hash(`${c.req.header('CF-Connecting-IP') || 'local'}:${bucket}`);
  const row = await c.env.DB.prepare('INSERT INTO auth_limits(id,count,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(id, time + 300).first();
  if (row.count > 40) throw fail('尝试过于频繁，请五分钟后再试', 429);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM auth_limits WHERE expires_at<?').bind(time),
    c.env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at<?').bind(time),
    c.env.DB.prepare('DELETE FROM web_sessions WHERE expires_at<?').bind(time),
  ]);
}
async function challenge(c, value, kind, user = null) {
  const name = '__Host-sb_challenge';
  const previous = cookie(c, name);
  if (previous) await c.env.DB.prepare('DELETE FROM webauthn_challenges WHERE token_hash=?').bind(await hash(previous)).run();
  const token = random();
  await c.env.DB.prepare('INSERT INTO webauthn_challenges VALUES (?,?,?,?,?)').bind(await hash(token), value, kind, user, seconds() + 300).run();
  setCookie(c, name, token, 300);
}
async function consume(c, kind, user = null) {
  const token = cookie(c, '__Host-sb_challenge');
  if (!token) throw fail('验证请求已过期，请重新开始');
  // 原子删除并返回：并发请求也不能重复使用挑战。
  const row = await c.env.DB.prepare('DELETE FROM webauthn_challenges WHERE token_hash=? RETURNING *').bind(await hash(token)).first();
  setCookie(c, '__Host-sb_challenge', '', 0);
  if (!row || row.kind !== kind || row.user_id !== user || row.expires_at <= seconds()) throw fail('验证请求已过期，请重新开始');
  return row.challenge;
}
const fresh = user => {
  if (!Number.isFinite(user.authAt) || seconds() - user.authAt > 300) throw fail('请先用 Passkey 重新登录，或通过邮箱重新验证，再管理 Passkey', 403);
};
export function installPasskeys(app, identity) {
  // 放在业务鉴权中间件之前，仅认证入口匿名可达；所有写请求要求同源。
  app.use('/api/auth/*', async (c, next) => {
    origin(c);
    if (c.req.method !== 'GET' && c.req.header('Origin') !== new URL(c.req.url).origin) throw fail('不允许跨站操作', 403);
    await next();
  });
  app.post('/api/auth/login/options', async c => {
    await limited(c);
    const { expectedRPID } = origin(c);
    const options = await generateAuthenticationOptions({ rpID: expectedRPID, userVerification: 'required' });
    await challenge(c, options.challenge, 'login');
    return c.json(options);
  });
  app.post('/api/auth/login/verify', async c => {
    await limited(c);
    const expectedChallenge = await consume(c, 'login');
    const response = await c.req.json();
    const row = await c.env.DB.prepare('SELECT p.*,u.email FROM passkeys p JOIN users u ON p.user_id=u.id WHERE p.id=? AND p.revoked_at IS NULL').bind(String(response.id || '')).first();
    if (!row || row.email.toLowerCase() !== (c.env.OWNER_EMAIL || '').toLowerCase()) throw fail('Passkey 验证失败', 401);
    if (response.response?.userHandle !== btoa(row.user_id).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')) throw fail('Passkey 账号不匹配', 401);
    let result;
    try {
      result = await verifyAuthenticationResponse({ response, expectedChallenge, ...origin(c), requireUserVerification: true, credential: { id: row.id, publicKey: Uint8Array.from(JSON.parse(row.public_key)), counter: row.counter, transports: JSON.parse(row.transports) } });
    } catch { throw fail('Passkey 验证失败，请重新尝试', 401); }
    if (!result.verified) throw fail('Passkey 验证失败', 401);
    const changed = await c.env.DB.prepare('UPDATE passkeys SET counter=?,last_used_at=? WHERE id=? AND counter=? AND revoked_at IS NULL').bind(result.authenticationInfo.newCounter, seconds(), row.id, row.counter).run();
    if (!changed.meta.changes) throw fail('凭据已变更，请重新登录', 401);
    await createSession(c, { id: row.user_id, email: row.email }, row.id);
    return c.json({ ok: true });
  });
  app.use('/api/auth/passkeys*', async (c, next) => { c.set('passkeyUser', await identity(c)); await next(); });
  app.get('/api/auth/passkeys', async c => {
    const { results } = await c.env.DB.prepare('SELECT id,name,created_at,last_used_at FROM passkeys WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at DESC').bind(c.get('passkeyUser').id).all();
    return c.json({ passkeys: results });
  });
  app.post('/api/auth/passkeys/options', async c => {
    await limited(c);
    const user = c.get('passkeyUser'); fresh(user);
    const { results } = await c.env.DB.prepare('SELECT id,transports FROM passkeys WHERE user_id=? AND revoked_at IS NULL').bind(user.id).all();
    if (results.length >= 10) throw fail('最多添加十个 Passkey，请先撤销旧凭据');
    const options = await generateRegistrationOptions({ rpName: 'Sensebook', rpID: origin(c).expectedRPID, userID: new TextEncoder().encode(user.id), userName: user.email, attestationType: 'none', supportedAlgorithmIDs: [-7, -257], authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, excludeCredentials: results.map(p => ({ id: p.id, transports: JSON.parse(p.transports) })) });
    await challenge(c, options.challenge, 'register', user.id);
    return c.json(options);
  });
  app.post('/api/auth/passkeys/verify', async c => {
    const user = c.get('passkeyUser'); fresh(user);
    const expectedChallenge = await consume(c, 'register', user.id);
    const { response, name } = await c.req.json();
    let result;
    try { result = await verifyRegistrationResponse({ response, expectedChallenge, ...origin(c), requireUserVerification: true }); }
    catch { throw fail('Passkey 注册验证失败，请重新尝试'); }
    if (!result.verified) throw fail('Passkey 注册验证失败');
    const cred = result.registrationInfo.credential;
    await c.env.DB.prepare('INSERT INTO users(id,email,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(user.id, user.email, new Date().toISOString()).run();
    await c.env.DB.prepare('INSERT INTO passkeys(id,user_id,public_key,counter,transports,name,created_at) VALUES (?,?,?,?,?,?,?)').bind(cred.id, user.id, JSON.stringify(Array.from(cred.publicKey)), cred.counter, JSON.stringify(cred.transports || []), String(name || '我的 Passkey').slice(0, 80), seconds()).run();
    return c.json({ ok: true });
  });
  app.delete('/api/auth/passkeys/:id', async c => {
    const user = c.get('passkeyUser'); fresh(user);
    const id = c.req.param('id');
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE passkeys SET revoked_at=? WHERE id=? AND user_id=?').bind(seconds(), id, user.id),
      c.env.DB.prepare('DELETE FROM web_sessions WHERE credential_id=? AND user_id=?').bind(id, user.id),
    ]);
    return c.json({ ok: true });
  });
}
