/**
 * Pedidos HTTP a fontes externas (Yahoo, justETF, FT) com timeout e retry.
 * Sem timeout, um fornecedor lento bloqueava a atualização inteira e podia
 * esgotar o tempo de execução do Worker.
 */

export interface FetchRetryOptions {
  /** Tempo máximo por tentativa (ms). */
  timeoutMs?: number;
  /** Tentativas extra em erro de rede, timeout, 429 ou 5xx. */
  retries?: number;
  /** Espera base entre tentativas (ms), duplicada a cada tentativa. */
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 8000,
    retries = 1,
    backoffMs = 400,
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = opts;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(input, { ...init, signal: controller.signal });
      if (!isRetryableStatus(res.status) || attempt === retries) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
      if (attempt === retries) break;
    } finally {
      clearTimeout(timer);
    }
    await sleep(backoffMs * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error("Pedido falhou.");
}

/** Executa `fn` sobre `items` com no máximo `limit` em simultâneo, mantendo a ordem. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
