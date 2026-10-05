/** Allowlisted UI copy. Neither remote nor renderer exception text is rendered. */
const PRESENTATIONS = {
  unsupported: { code: "unsupported", message: "A prévia está disponível para PDF, PNG, JPG e WebP. Baixe este documento para abri-lo no seu aplicativo." },
  "too-large": { code: "too-large", message: "A prévia está disponível para arquivos de até 20 MB. Baixe o original para abrir este documento." },
  "image-too-large": { code: "too-large", message: "Esta imagem tem dimensões muito grandes para a prévia. Baixe o original para abri-la." },
  invalid: { code: "invalid", message: "O conteúdo do arquivo não corresponde a um PDF ou imagem válido. Baixe o original para conferir." },
  access: { code: "access", message: "Seu acesso a este documento não está disponível. Feche a prévia e atualize a página." },
  unavailable: { code: "unavailable", message: "Este documento não está mais disponível." },
  network: { code: "network", message: "Não foi possível carregar a prévia. Tente novamente ou baixe o original." },
  timeout: { code: "network", message: "A prévia demorou demais. Tente novamente ou baixe o original." },
  "pdf-password": { code: "invalid", message: "Este PDF é protegido por senha. Baixe o original para abri-lo." },
  "pdf-open": { code: "invalid", message: "Não foi possível exibir este PDF. Baixe o original para abri-lo." },
  "pdf-page": { code: "invalid", message: "Não foi possível exibir esta página. Baixe o original para abri-la." },
  "pdf-timeout": { code: "invalid", message: "Este PDF demorou demais para abrir. Baixe o original para continuar." },
  "pdf-page-timeout": { code: "invalid", message: "Esta página demorou demais para renderizar. Baixe o original para continuar." },
  "image-decode": { code: "invalid", message: "Não foi possível decodificar esta imagem. Baixe o original para abri-la." },
  "reader-load": { code: "invalid", message: "O leitor de PDF não carregou. Atualize a página ou baixe o original." },
} as const;
export type PreviewErrorReason = keyof typeof PRESENTATIONS;
function knownReason(value: unknown): PreviewErrorReason {
  return typeof value === "string" && Object.hasOwn(PRESENTATIONS, value) ? value as PreviewErrorReason : "network";
}
export class DocumentPreviewError extends Error {
  readonly reason: PreviewErrorReason;
  readonly code: (typeof PRESENTATIONS)[PreviewErrorReason]["code"];
  constructor(reason: PreviewErrorReason) {
    const safeReason = knownReason(reason);
    super(PRESENTATIONS[safeReason].message);
    this.name = "DocumentPreviewError";
    this.reason = safeReason;
    this.code = PRESENTATIONS[safeReason].code;
  }
}
export function previewErrorPresentation(value: unknown) {
  const reason = value instanceof DocumentPreviewError ? knownReason(value.reason) : "network";
  return { ...PRESENTATIONS[reason] };
}
