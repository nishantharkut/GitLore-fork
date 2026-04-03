/**
 * Minimal class merge for shadcn / React Bits CLI installs (no tailwind-merge).
 */
export function cn(...inputs: Array<string | undefined | null | false>): string {
  return inputs.filter(Boolean).join(" ");
}
