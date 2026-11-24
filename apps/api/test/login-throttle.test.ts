import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IP_MAX_FAILS, LOCK_MS, LoginThrottle, MAX_FAILS } from '../src/auth/login-throttle';

const locked = (t: LoginThrottle, login: string, ip: string, now: number) => {
  try {
    t.assertNotLocked(login, ip, now);
    return false;
  } catch {
    return true;
  }
};

test('M4: 5 lần sai khóa đúng cặp IP+tài khoản, IP khác không bị ảnh hưởng', () => {
  const t = new LoginThrottle();
  const now = 1_000_000;
  for (let i = 0; i < MAX_FAILS; i++) t.recordFail('owner@x.vn', '1.1.1.1', now + i);
  assert.equal(locked(t, 'owner@x.vn', '1.1.1.1', now + 10), true);
  assert.equal(locked(t, 'OWNER@x.vn ', '1.1.1.1', now + 10), true); // chuẩn hóa tên
  assert.equal(locked(t, 'owner@x.vn', '2.2.2.2', now + 10), false);
  assert.equal(locked(t, 'other@x.vn', '1.1.1.1', now + 10), false);
});

test('khóa không bị kéo dài bởi các lần thử trong lúc khóa', () => {
  const t = new LoginThrottle();
  const now = 5_000_000;
  for (let i = 0; i < MAX_FAILS; i++) t.recordFail('a', 'ip', now);
  for (let k = 1; k <= 20; k++) t.recordFail('a', 'ip', now + k * 10_000); // gõ sai tiếp lúc đang khóa
  assert.equal(locked(t, 'a', 'ip', now + LOCK_MS - 1), true);
  assert.equal(locked(t, 'a', 'ip', now + LOCK_MS + 1), false);
});

test('đăng nhập đúng xóa đếm của cặp; trần theo IP chung khóa mọi tài khoản của IP', () => {
  const t = new LoginThrottle();
  const now = 9_000_000;
  for (let i = 0; i < MAX_FAILS - 1; i++) t.recordFail('a', 'ip', now);
  t.recordSuccess('a', 'ip');
  t.recordFail('a', 'ip', now);
  assert.equal(locked(t, 'a', 'ip', now), false);
  const t2 = new LoginThrottle();
  for (let i = 0; i < IP_MAX_FAILS; i++) t2.recordFail(`u${i}`, 'evil', now);
  assert.equal(locked(t2, 'owner', 'evil', now + 1), true);
  assert.equal(locked(t2, 'owner', 'good', now + 1), false);
});
