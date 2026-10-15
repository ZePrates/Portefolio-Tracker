import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Cor de um ganho (verde), perda (vermelho) ou zero. */
export const pnlTone = (v: number) =>
  v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground";
