import type { ReactNode } from "react";
import { exposureEUR } from "@/lib/exposure-display";
import { formatEUR, formatMoney, formatSignedEUR } from "@/lib/format";

// Modo privado: os montantes aparecem desfocados. Por baixo do desfoque fica sempre o
// mesmo montante fictício, por isso o valor real (nem a ordem de grandeza) nunca chega à
// página — não se lê ao copiar, inspecionar ou com um leitor de ecrã.
const FAKE_AMOUNT = 12345.67;

const blurred = (text: string): ReactNode => (
  <span
    role="img"
    aria-label="Valor escondido"
    className="inline-block select-none whitespace-nowrap [filter:blur(0.3em)]"
  >
    {text}
  </span>
);

export const privateEUR = (value: number, hidden: boolean): ReactNode =>
  hidden ? blurred(formatEUR(FAKE_AMOUNT)) : formatEUR(value);

export const privateSignedEUR = (value: number, hidden: boolean): ReactNode =>
  hidden ? blurred(formatSignedEUR(FAKE_AMOUNT)) : formatSignedEUR(value);

export const privateMoney = (value: number, currency: string, hidden: boolean): ReactNode =>
  hidden ? blurred(formatMoney(FAKE_AMOUNT, currency)) : formatMoney(value, currency);

export const privateExposureEUR = (value: number, hidden: boolean): ReactNode =>
  hidden ? blurred(exposureEUR(FAKE_AMOUNT)) : exposureEUR(value);

/** Qualquer texto que revele montantes (ex.: gramas de metal), desfocado no modo privado. */
export const privateText = (
  text: string,
  hidden: boolean,
  fake = formatEUR(FAKE_AMOUNT),
): ReactNode => (hidden ? blurred(fake) : text);
