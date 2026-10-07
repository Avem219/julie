import { randomBytes } from 'node:crypto';

const MB = 1024 * 1024;
type Rule = { exts: string[]; maxBytes: number; magic: (b: Uint8Array) => boolean };
const at = (b: Uint8Array, off: number, s: string) => [...s].every((c, i) => b[off + i] === c.charCodeAt(0));

/** Allowlist only. SVG/HTML are deliberately excluded (script execution risk). */
export const ALLOWED_UPLOADS: Readonly<Record<string, Rule>> = {
  'application/pdf': { exts: ['pdf'], maxBytes: 25 * MB, magic: (b) => at(b, 0, '%PDF-') },
  'image/png': { exts: ['png'], maxBytes: 10 * MB, magic: (b) => b[0] === 0x89 && at(b, 1, 'PNG') },
  'image/jpeg': { exts: ['jpg', 'jpeg'], maxBytes: 10 * MB, magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { exts: ['webp'], maxBytes: 10 * MB, magic: (b) => at(b, 0, 'RIFF') && at(b, 8, 'WEBP') },
  'audio/mpeg': { exts: ['mp3'], maxBytes: 50 * MB, magic: (b) => at(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  'video/mp4': { exts: ['mp4'], maxBytes: 200 * MB, magic: (b) => at(b, 4, 'ftyp') },
};
const DANGEROUS = new Set(['exe','dll','bat','cmd','com','msi','sh','bash','js','mjs','html','htm','svg','php','phtml','jsp','asp','aspx',
  'jar','ps1','py','rb','pl','vbs','scr','lnk','apk','app','dmg','swf','xml']);

export const sanitizeFilename = (name: string): string =>
  name.replace(/[\\/]+/g, '/').split('/').pop()!.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').trim().slice(0, 120) || 'file';

export type UploadCheck = { ok: true; mime: string; ext: string; displayName: string } | { ok: false; reason: string };

/** `head` = first bytes of the file (>= 16). Trust the bytes, not the browser-declared type. */
export function validateUpload(f: { filename: string; declaredMime: string; sizeBytes: number; head: Uint8Array }): UploadCheck {
  const rule = ALLOWED_UPLOADS[f.declaredMime];
  if (!rule) return { ok: false, reason: 'File type not allowed' };
  if (!Number.isInteger(f.sizeBytes) || f.sizeBytes <= 0) return { ok: false, reason: 'Empty file' };
  if (f.sizeBytes > rule.maxBytes) return { ok: false, reason: 'File too large' };
  const displayName = sanitizeFilename(f.filename);
  const parts = displayName.toLowerCase().split('.');
  if (parts.length < 2) return { ok: false, reason: 'Missing file extension' };
  if (parts.slice(1).some((p) => DANGEROUS.has(p))) return { ok: false, reason: 'Dangerous file extension' };
  const ext = parts[parts.length - 1];
  if (!rule.exts.includes(ext)) return { ok: false, reason: 'Extension does not match file type' };
  if (!rule.magic(f.head)) return { ok: false, reason: 'File content does not match declared type' };
  return { ok: true, mime: f.declaredMime, ext, displayName };
}

/** Storage keys are random and never contain user-supplied names. `ext` must come from validateUpload. */
export function generateStorageKey(ext: string, now = new Date()): string {
  if (!/^[a-z0-9]{2,5}$/.test(ext)) throw new Error('Invalid extension');
  return `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomBytes(16).toString('hex')}.${ext}`;
}
