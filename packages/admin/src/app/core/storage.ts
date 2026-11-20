/** localStorage che non fallisce (modalità privata, test). */
export const storage = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(`jeko.${key}`) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(`jeko.${key}`, value);
    } catch {
      /* niente */
    }
  },
};
