// Presentation-only translations. Native parser results, error objects,
// filenames, source URLs and dataset values remain unchanged in Redux.
export function importErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  // Reviewed diagnostic input: callers classify or compare this text; only
  // dataImportErrorMessage's fixed Portuguese copy may reach the import UI.
  if (error && typeof error === "object" && "message" in error) return String(error.message ?? "");
  return "";
}

export function isNativeImportError(message: string): boolean {
  return /^(?:Can not process uploaded file|Failed to upload files|Error loading https?:\/\/|Unexpected (?:end|token)|Unterminated|Expected .+JSON|JSON\.parse:|arrow type not supported:)/i.test(message);
}

export function dataImportErrorMessage(error: unknown): string {
  const message = importErrorText(error);
  if (/arrow type not supported:/i.test(message)) {
    return "Um tipo de campo não é compatível com este formato.";
  }
  if (/unknown file format|not supported|unsupported|no valid loader/i.test(message)) {
    return "Formato de arquivo não reconhecido. Use CSV, JSON, GeoJSON, Arrow ou Parquet.";
  }
  if (/JSON|Unexpected (?:end|token)|Unterminated/i.test(message)) {
    return "Não foi possível ler o JSON. Verifique a sintaxe e tente novamente.";
  }
  if (/failed to fetch|network|load failed|error loading https?:\/\//i.test(message)) {
    return "Não foi possível obter os dados. Verifique a URL, a conexão e a política CORS do servidor.";
  }
  if (/empty|no rows|no records/i.test(message)) return "O arquivo não contém registros compatíveis.";
  return "Não foi possível importar os dados. Verifique o arquivo ou a fonte e tente novamente.";
}

type ImportProgress = { message?: string; error?: unknown; [key: string]: unknown };
export function localizeImportProgress(progress: Record<string, ImportProgress> | undefined) {
  return Object.fromEntries(Object.entries(progress ?? {}).map(([key, item]) => [key, {
    ...item,
    message: item.message === "loading..." ? "Carregando arquivo…"
      : item.message === "processing..." ? "Processando arquivo…"
      : item.message === "Done" ? "Concluído" : item.message,
    error: item.error ? { message: dataImportErrorMessage(item.error) } : item.error,
  }]));
}
