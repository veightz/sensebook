import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, createHash, sign, randomBytes } from 'node:crypto';
import { encodeCBOR } from '@levischuck/tiny-cbor';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import app from '../worker/index.js';
import { hash } from '../worker/passkeys.js';
let mf, DB, id, privateKey, publicKey, session;
const site = 'https://sensebook.test';
const env = () => ({ DB, OWNER_EMAIL: 'owner@example.com', PASSKEY_ORIGIN: site });
const b64 = x => Buffer.from(x).toString('base64url');
const sha = x => createHash('sha256').update(x).digest();
const cookies = r => r.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
async function request(path, body, cookie = '', method = 'POST', extra = {}) {
 return app.fetch(new Request(site + path, { method, headers: { Origin: site, Cookie: cookie, 'Content-Type': 'application/json', ...extra }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }), env());
}
async function options() {
 const r = await request('/api/auth/login/options', {}); assert.equal(r.status, 200); return { data: await r.json(), cookie: cookies(r) };
}
function assertion(challenge, { origin = site, flags = 5, rp = 'sensebook.test', badSignature = false } = {}) {
 const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
 const auth = Buffer.concat([sha(rp), Buffer.from([flags,0,0,0,0])]);
 return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64(client), authenticatorData: b64(auth), signature: b64(badSignature ? randomBytes(256) : sign('sha256', Buffer.concat([auth, sha(client)]), privateKey)), userHandle: b64('owner') } };
}
before(async () => {
 mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-09-01', d1Databases: ['DB'] }));
 DB = await mf.getD1Database('DB');
 for (const file of ['0001_personal.sql','0002_model_profiles.sql','0003_passkeys.sql']) {
  const sql = readFileSync(new URL('../migrations/' + file, import.meta.url),'utf8');
  await DB.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => DB.prepare(s)));
 }
 await DB.prepare('INSERT INTO users VALUES (?,?,?)').bind('owner','owner@example.com',new Date().toISOString()).run();
 session = randomBytes(32).toString('hex');
 await DB.prepare('INSERT INTO web_sessions VALUES (?,?,?,?,?)').bind(await hash(session),'owner',null,Math.floor(Date.now()/1000),Math.floor(Date.now()/1000)+86400).run();
 ({ privateKey, publicKey } = generateKeyPairSync('rsa',{ modulusLength:2048 }));
 id = b64(randomBytes(32));
});
after(async () => mf?.dispose());
test('registration requires authenticated owner, same origin and recent authentication', async () => {
 assert.equal((await request('/api/auth/passkeys/options', {}, '', 'POST', { Origin:'https://evil.test' })).status,403);
 assert.equal((await request('/api/auth/passkeys/options', {})).status,503);
 await DB.prepare('UPDATE web_sessions SET auth_at=0').run();
 assert.equal((await request('/api/auth/passkeys/options',{},'__Host-sb_session='+session)).status,403);
 await DB.prepare('UPDATE web_sessions SET auth_at=?').bind(Math.floor(Date.now()/1000)).run();
});
test('register real credential with none attestation; reject challenge replay', async () => {
 const r = await request('/api/auth/passkeys/options',{},'__Host-sb_session='+session);
 assert.equal(r.status,200); const o = await r.json();
 const jwk = publicKey.export({format:'jwk'});
 const cose = encodeCBOR(new Map([[1,3],[3,-257],[-1,Buffer.from(jwk.n,'base64url')],[-2,Buffer.from(jwk.e,'base64url')]]));
 const rawId = Buffer.from(id,'base64url'); const length = Buffer.alloc(2);length.writeUInt16BE(rawId.length);
 const auth = Buffer.concat([sha('sensebook.test'),Buffer.from([0x45,0,0,0,0]),Buffer.alloc(16),length,rawId,Buffer.from(cose)]);
 const response = { id, rawId:id, type:'public-key', clientExtensionResults:{}, response:{clientDataJSON:b64(JSON.stringify({type:'webauthn.create',challenge:o.challenge,origin:site})),attestationObject:b64(encodeCBOR(new Map([['fmt','none'],['attStmt',new Map()],['authData',auth]]))),transports:['internal']} };
 const cookie = '__Host-sb_session='+session+'; '+cookies(r);
 const verified = await request('/api/auth/passkeys/verify',{response,name:'Test device'},cookie);
 assert.equal(verified.status,200,await verified.text());
 assert.equal((await request('/api/auth/passkeys/verify',{response},cookie)).status,400);
 const list = await request('/api/auth/passkeys',undefined,'__Host-sb_session='+session,'GET');
 const entries = (await list.json()).passkeys;assert.equal(entries.length,1);assert.equal(entries[0].name,'Test device');assert.equal(entries[0].public_key,undefined);
});
test('reject wrong origin, RP, signature and missing user verification', async () => {
 for (const mutation of [{origin:'https://evil.test'},{rp:'evil.test'},{badSignature:true},{flags:1}]) {
  const o = await options();
  assert.equal((await request('/api/auth/login/verify',assertion(o.data.challenge,mutation),o.cookie)).status,401);
 }
});
test('reject stolen or expired challenge', async () => {
 const o = await options();
 assert.equal((await request('/api/auth/login/verify',assertion(o.data.challenge))).status,400);
 await DB.prepare('UPDATE webauthn_challenges SET expires_at=0').run();
 assert.equal((await request('/api/auth/login/verify',assertion(o.data.challenge),o.cookie)).status,400);
});
test('passkey login yields owner session; challenge cannot replay; logout revokes session', async () => {
 const o = await options(), body = assertion(o.data.challenge);
 const r = await request('/api/auth/login/verify',body,o.cookie);assert.equal(r.status,200,await r.clone().text());
 const cookie = cookies(r);assert.match(cookie,/__Host-sb_session=/);
 assert.equal((await request('/api/me',undefined,cookie,'GET')).status,200);
 assert.equal((await request('/api/auth/login/verify',body,o.cookie)).status,400);
 assert.equal((await request('/api/logout',{},cookie)).status,200);
 assert.equal((await request('/api/me',undefined,cookie,'GET')).status,401);
});
test('revoking credential invalidates its sessions and future logins', async () => {
 const o=await options();const r=await request('/api/auth/login/verify',assertion(o.data.challenge),o.cookie); const cookie=cookies(r);
 assert.equal((await request('/api/auth/passkeys/'+id,{},'__Host-sb_session='+session,'DELETE')).status,200);
 assert.equal((await request('/api/me',undefined,cookie,'GET')).status,401);
 const n=await options();assert.equal((await request('/api/auth/login/verify',assertion(n.data.challenge),n.cookie)).status,401);
});
test('public auth endpoints reject cross-site requests and enforce throttling', async () => {
 assert.equal((await request('/api/auth/login/options',{},'', 'POST',{Origin:'https://evil.test'})).status,403);
 assert.equal((await request('/api/auth/login/options',{},'', 'POST',{Origin:''})).status,403);
 let last;
 for(let i=0;i<41;i++) last=await request('/api/auth/login/options',{},'', 'POST',{'CF-Connecting-IP':'test-rate-limit'});
 assert.equal(last.status,429);
});
