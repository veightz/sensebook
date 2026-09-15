import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { createUser, findUserByEmail, findUserById } from './db.js';

const encoder = new TextEncoder();

function secretKey() {
  const secret = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
  return encoder.encode(secret);
}

export async function register(email, password) {
  if (!email || !password || password.length < 6) {
    const err = new Error('邮箱与密码必填，密码至少 6 位');
    err.status = 400;
    throw err;
  }
  if (findUserByEmail(email)) {
    const err = new Error('该邮箱已注册');
    err.status = 409;
    throw err;
  }
  const password_hash = await bcrypt.hash(password, 10);
  const user = createUser(email.toLowerCase().trim(), password_hash);
  const token = await signToken(user);
  return { user: { id: user.id, email: user.email }, token };
}

export async function login(email, password) {
  const row = findUserByEmail((email || '').toLowerCase().trim());
  if (!row) {
    const err = new Error('邮箱或密码错误');
    err.status = 401;
    throw err;
  }
  const ok = await bcrypt.compare(password || '', row.password_hash);
  if (!ok) {
    const err = new Error('邮箱或密码错误');
    err.status = 401;
    throw err;
  }
  const user = { id: row.id, email: row.email };
  const token = await signToken(user);
  return { user, token };
}

async function signToken(user) {
  return new SignJWT({ sub: user.id, email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secretKey());
}

export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, secretKey());
  const user = findUserById(payload.sub);
  if (!user) {
    const err = new Error('用户不存在');
    err.status = 401;
    throw err;
  }
  return user;
}
