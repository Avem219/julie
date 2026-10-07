import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrincipal, hasRole, hasPermission, requireRole, requirePermission, canManageOwned } from './rbac.ts';
import { AppError } from '../errors.ts';

const student = buildPrincipal('u1', ['STUDENT']);
const teacher = buildPrincipal('t1', ['TEACHER']);
const admin = buildPrincipal('a1', ['ADMIN']);
const dev = buildPrincipal('d1', ['DEVELOPER']);

test('roles map to their own permissions only', () => {
  assert.ok(hasPermission(student, 'quiz:attempt'));
  assert.ok(!hasPermission(student, 'course:manage_own'));
  assert.ok(!hasPermission(teacher, 'user:manage'));
  assert.ok(!hasPermission(dev, 'user:manage'));
  assert.ok(!hasPermission(dev, 'audit:read'));
});
test('developer does not gain admin privileges', () => {
  assert.ok(!hasRole(dev, 'ADMIN'));
  assert.throws(() => requireRole(dev, 'ADMIN'), (e) => e instanceof AppError && e.status === 403);
});
test('students cannot call teacher/admin permissions', () => {
  assert.throws(() => requirePermission(student, 'access_grant:manage'), (e) => e instanceof AppError && e.status === 403);
  requirePermission(admin, 'access_grant:manage');
});
test('multiple roles union their permissions', () => {
  const both = buildPrincipal('x', ['STUDENT', 'TEACHER']);
  assert.ok(hasPermission(both, 'quiz:attempt') && hasPermission(both, 'quiz:manage_own'));
});
test('unknown roles grant nothing', () => {
  assert.equal(buildPrincipal('x', ['SUPERUSER']).permissions.size, 0);
});
test('ownership: teacher manages own course only; admin manages any', () => {
  assert.ok(canManageOwned(teacher, 'course:manage_any', 'course:manage_own', ['t1']));
  assert.ok(!canManageOwned(teacher, 'course:manage_any', 'course:manage_own', ['someone-else']));
  assert.ok(canManageOwned(admin, 'course:manage_any', 'course:manage_own', ['someone-else']));
  assert.ok(!canManageOwned(student, 'course:manage_any', 'course:manage_own', ['u1']));
});
