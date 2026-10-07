import { forbidden } from '../errors.ts';

export type RoleKey = 'STUDENT' | 'TEACHER' | 'ADMIN' | 'DEVELOPER';
export type RolePermissionMap = Readonly<Record<string, readonly string[]>>;

/** Seed source for role_permissions. The database is the runtime source of truth. Roles do not imply each other. */
export const DEFAULT_ROLE_PERMISSIONS: RolePermissionMap = {
  STUDENT: [
    'course:read', 'lesson:read', 'enrollment:self', 'quiz:attempt', 'progress:self',
    'goal:self', 'task:self', 'timetable:self', 'ai:use', 'notification:self', 'subscription:self',
  ],
  TEACHER: [
    'course:read', 'lesson:read', 'course:manage_own', 'lesson:manage_own', 'resource:manage_own',
    'quiz:manage_own', 'enrollment:manage_own', 'progress:read_own_students',
    'announcement:manage_own', 'notification:self', 'timetable:self',
  ],
  ADMIN: [
    'user:read_any', 'user:manage', 'role:manage', 'permission:read', 'course:manage_any',
    'subject:manage', 'subscription_plan:manage', 'access_grant:manage', 'news:manage',
    'announcement:manage_any', 'audit:read', 'security:read', 'settings:manage',
    'analytics:read', 'notification:broadcast', 'feature_flag:manage', 'resource:manage_any',
  ],
  DEVELOPER: [
    'developer:app_manage', 'api_key:manage_own', 'webhook:manage_own',
    'feature_flag:read', 'docs:read', 'diagnostics:read_own',
  ],
};

/** Built server-side from DB rows only (never from client input). */
export type Principal = {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly permissions: ReadonlySet<string>;
};

export function buildPrincipal(
  userId: string,
  activeRoles: readonly string[],
  rolePermissions: RolePermissionMap = DEFAULT_ROLE_PERMISSIONS,
): Principal {
  const perms = new Set<string>();
  for (const r of activeRoles) for (const p of rolePermissions[r] ?? []) perms.add(p);
  return { userId, roles: [...new Set(activeRoles)], permissions: perms };
}

export const hasRole = (p: Principal, ...roles: string[]) => roles.some((r) => p.roles.includes(r));
export const hasPermission = (p: Principal, perm: string) => p.permissions.has(perm);

export function requireRole(p: Principal, ...roles: string[]): void {
  if (!hasRole(p, ...roles)) throw forbidden();
}
export function requirePermission(p: Principal, perm: string): void {
  if (!hasPermission(p, perm)) throw forbidden();
}

/** Ownership check: broad permission always works; narrow permission only for owners. */
export function canManageOwned(p: Principal, anyPerm: string, ownPerm: string, ownerIds: readonly string[]): boolean {
  if (hasPermission(p, anyPerm)) return true;
  return hasPermission(p, ownPerm) && ownerIds.includes(p.userId);
}
export function requireManageOwned(p: Principal, anyPerm: string, ownPerm: string, ownerIds: readonly string[]): void {
  if (!canManageOwned(p, anyPerm, ownPerm, ownerIds)) throw forbidden();
}
