/**
 * Erros da base de dados → mensagens em PT-PT para o utilizador.
 * O erro original fica no log do servidor (nunca é exposto em bruto).
 */

interface DbErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
}

const MESSAGES: Record<string, string> = {
  "23505": "Este registo já existe (duplicado).",
  "23503": "O registo está ligado a outro que não existe ou foi apagado.",
  "23514": "Valor inválido: viola uma regra de validação dos dados.",
  "23502": "Falta um campo obrigatório.",
  "22P02": "Formato de valor inválido.",
  "42501": "Sem permissão para esta operação.",
  PGRST116: "Registo não encontrado.",
};

export function dbErrorMessage(error: DbErrorLike | null | undefined, fallback?: string): string {
  if (!error) return fallback ?? "Erro desconhecido na base de dados.";
  return (error.code && MESSAGES[error.code]) || fallback || "Erro ao aceder à base de dados.";
}

/** Constrói o Error a lançar; regista o erro original no servidor. */
export function dbError(error: DbErrorLike | null | undefined, fallback?: string): Error {
  if (error) console.error("[db]", error.code ?? "", error.message ?? "", error.details ?? "");
  return new Error(dbErrorMessage(error, fallback));
}
