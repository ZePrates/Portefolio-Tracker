/** Lê um separador válido do URL, com o primeiro como omissão. */
export function tabSearch<T extends string>(ids: readonly T[]) {
  return (search: Record<string, unknown>): { tab?: T } => {
    const tab = search["tab"];
    return typeof tab === "string" && (ids as readonly string[]).includes(tab) && tab !== ids[0]
      ? { tab: tab as T }
      : {};
  };
}
