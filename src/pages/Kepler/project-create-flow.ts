import {
  buildSaveRequestHeaders,
  readSaveResponseDiagnostics,
  type ClientSaveAttempt,
  type SaveResponseDiagnostics,
} from "./save-observability";
import {
  prepareProjectCreateTransport,
  type PreparedProjectCreateTransport,
} from "./project-create-transport";

export type ProjectCreateRequestStage =
  | "creating_record"
  | "preparing_files"
  | "finalizing";

type LegacyPreview = {
  dataUrl: string;
  method: string;
  diagnostics: string[];
} | null;

export type ProjectCreateFlowResult = {
  response: Response;
  data: any;
  diagnostics: SaveResponseDiagnostics;
  prepared: PreparedProjectCreateTransport;
  transport: "inline" | "stream";
  createdSlug: string;
  revision: number;
};

type ProjectCreateFlowOptions = {
  attempt: ClientSaveAttempt;
  name: string;
  description: string;
  organizationId: unknown;
  idempotencyKey: string;
  config: any;
  legacy: LegacyPreview;
  fetchImpl?: typeof fetch;
  onPrepared?: (prepared: PreparedProjectCreateTransport) => void;
  onStage?: (stage: ProjectCreateRequestStage) => void;
};

export class ProjectCreateFlowError extends Error {
  response: Response;
  data: any;
  diagnostics: SaveResponseDiagnostics;
  stage: ProjectCreateRequestStage;
  prepared: PreparedProjectCreateTransport;

  constructor(
    message: string,
    {
      response,
      data,
      diagnostics,
      stage,
      prepared,
    }: {
      response: Response;
      data: any;
      diagnostics: SaveResponseDiagnostics;
      stage: ProjectCreateRequestStage;
      prepared: PreparedProjectCreateTransport;
    },
  ) {
    super(message);
    this.name = "ProjectCreateFlowError";
    this.response = response;
    this.data = data;
    this.diagnostics = diagnostics;
    this.stage = stage;
    this.prepared = prepared;
  }
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: {
        message: "A API retornou uma resposta inesperada.",
        code: "INVALID_JSON_RESPONSE",
        category: "INFRASTRUCTURE",
        retryable: true,
        correlationId: response.headers.get("X-Correlation-Id") || undefined,
      },
    };
  }
}

function resolveConfigRevision(data: any) {
  return Math.max(
    0,
    Number(
      data?.configRevision ??
        data?.thumbnail?.revision ??
        data?.project?.configRevision ??
        0,
    ) || 0,
  );
}

export function isProjectCreationActive(data: any) {
  const lifecycleState =
    data?.lifecycle?.state ??
    data?.project?.lifecycle?.state ??
    data?.project?.lifecycleState ??
    null;

  return Boolean(
    data?.status === "active" ||
      data?.project?.active === true ||
      lifecycleState === "ACTIVE",
  );
}

function flowError(
  response: Response,
  data: any,
  diagnostics: SaveResponseDiagnostics,
  stage: ProjectCreateRequestStage,
  prepared: PreparedProjectCreateTransport,
) {
  return new ProjectCreateFlowError(
    data?.error?.message || "Não foi possível concluir a criação do projeto.",
    { response, data, diagnostics, stage, prepared },
  );
}

async function sendCreateRequest(
  fetchImpl: typeof fetch,
  attempt: ClientSaveAttempt,
  prepared: PreparedProjectCreateTransport,
) {
  const response = await fetchImpl("/api/projects", {
    method: "POST",
    credentials: "include",
    headers: buildSaveRequestHeaders(attempt, { forceJson: true }),
    body: prepared.requestBody,
  });
  const diagnostics = readSaveResponseDiagnostics(response, attempt);
  const data = await readJsonResponse(response);
  return { response, diagnostics, data };
}

async function sendLargeConfig(
  fetchImpl: typeof fetch,
  attempt: ClientSaveAttempt,
  prepared: PreparedProjectCreateTransport,
  slug: string,
  idempotencyKey: string,
) {
  const response = await fetchImpl(
    `/api/projects/${encodeURIComponent(slug)}/config`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        ...buildSaveRequestHeaders(attempt),
        "X-Maono-Creation-Key": idempotencyKey,
      },
      body: prepared.configBody,
    },
  );
  const diagnostics = readSaveResponseDiagnostics(response, attempt);
  const data = await readJsonResponse(response);
  return { response, diagnostics, data };
}

export async function executeProjectCreateFlow({
  attempt,
  name,
  description,
  organizationId,
  idempotencyKey,
  config,
  legacy,
  fetchImpl = fetch,
  onPrepared = () => {},
  onStage = () => {},
}: ProjectCreateFlowOptions): Promise<ProjectCreateFlowResult> {
  const prepared = prepareProjectCreateTransport(attempt, {
    name,
    description,
    organizationId,
    idempotencyKey,
    config,
    legacy,
  });
  onPrepared(prepared);

  onStage("creating_record");
  const created = await sendCreateRequest(fetchImpl, attempt, prepared);
  if (
    !created.response.ok ||
    created.data?.ok === false ||
    !created.data?.project?.slug
  ) {
    throw flowError(
      created.response,
      created.data,
      created.diagnostics,
      "creating_record",
      prepared,
    );
  }

  const createdSlug = String(created.data.project.slug);
  let finalResponse = created.response;
  let finalData = created.data;
  let finalDiagnostics = created.diagnostics;

  // Retry pós-commit: se a tentativa anterior terminou e só a resposta se
  // perdeu, o POST idempotente devolve ACTIVE e o cliente não reenvia bytes.
  if (prepared.large && !isProjectCreationActive(finalData)) {
    onStage("preparing_files");
    const streamed = await sendLargeConfig(
      fetchImpl,
      attempt,
      prepared,
      createdSlug,
      idempotencyKey,
    );
    finalResponse = streamed.response;
    finalData = streamed.data;
    finalDiagnostics = streamed.diagnostics;

    if (!finalResponse.ok || finalData?.ok === false) {
      throw flowError(
        finalResponse,
        finalData,
        finalDiagnostics,
        "preparing_files",
        prepared,
      );
    }
  }

  onStage("finalizing");
  if (!isProjectCreationActive(finalData)) {
    const inactiveData = {
      ...(finalData || {}),
      ok: false,
      error: {
        ...(finalData?.error || {}),
        message:
          finalData?.error?.message ||
          "A criação terminou sem confirmar o estado ACTIVE do projeto.",
        code: finalData?.error?.code || "PROJECT_CREATE_ACTIVE_NOT_CONFIRMED",
        category: finalData?.error?.category || "PROJECT",
        retryable: true,
      },
    };
    throw flowError(
      finalResponse,
      inactiveData,
      finalDiagnostics,
      "finalizing",
      prepared,
    );
  }

  return {
    response: finalResponse,
    data: finalData,
    diagnostics: finalDiagnostics,
    prepared,
    transport: prepared.large ? "stream" : "inline",
    createdSlug,
    revision: resolveConfigRevision(finalData),
  };
}
