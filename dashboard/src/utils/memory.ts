/**
 * RAM that programs are actually using.
 *
 * systeminformation's `used` is total minus free, which counts the disk cache Linux keeps in
 * spare RAM, so it sits near 100% on a healthy machine. `active` (total minus available) leaves
 * the cache out, because the kernel gives cache back as soon as programs need the memory.
 */
export function memInUse(mem: { total: number; used: number; available?: number; active?: number }): number {
  if (typeof mem.active === 'number') return mem.active;
  if (typeof mem.available === 'number') return Math.max(0, mem.total - mem.available);
  return mem.used;
}

/** Disk cache and buffers: memory that is filled but can be freed on demand. */
export function memCache(mem: { total: number; free: number; available?: number; active?: number; used: number }): number {
  return Math.max(0, mem.total - mem.free - memInUse(mem));
}
