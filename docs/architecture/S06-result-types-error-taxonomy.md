# S06 — Result Types e taxonomia de erros

## Objetivo

Padronizar falhas da plataforma Maõno com contrato estável para API, frontend, logs e suporte, preservando a causa técnica real sem depender de mensagens textuais.

## Envelope HTTP

```json
{
  "ok": false,
  "error": {
    "code": "DROPBOX_UPLOAD_FAILED",
    "category": "STORAGE",
    "retryable": true,
    "correlationId": "...",
    "message": "Não foi possível concluir a operação."
  }
}
```

`message` permanece por compatibilidade e UX, mas não é identidade de erro. A identidade para automação é `category + code`.

## Categorias oficiais

- `AUTH`
- `PERMISSION`
- `PROJECT`
- `MAP_CONFIG`
- `STORAGE`
- `PERFORMANCE`
- `SPATIAL`
- `ENGINE`
- `INFRASTRUCTURE`

Novas categorias não devem ser criadas fora deste conjunto sem revisão arquitetural.

## Result Types

A aplicação pode representar resultados internos como:

```text
ok(value)
err(MaonoError)
```

O contrato HTTP de sucesso existente não é alterado nesta sprint.

## MaonoError

`MaonoError` normaliza:

- `code`;
- `category`;
- `status`;
- `retryable`;
- `correlationId`;
- `details` internos controlados;
- `cause` somente no processo, nunca no payload público.

## Correlation ID

Toda resposta de erro gerada pelo helper HTTP recebe um `correlationId` e o mesmo valor é retornado no header:

```text
X-Correlation-Id
```

O boundary HTTP registra apenas metadados seguros do erro: código, categoria, status, retryable e correlationId. Stack, segredos, cookies e payloads não são serializados no envelope.

## Retryable

`retryable=true` significa que repetir a mesma operação sem alterar os dados pode razoavelmente funcionar, por exemplo indisponibilidade transitória, rate limit ou timeout.

Conflitos de revisão, permissão negada, JSON inválido, checksum divergente e recurso inexistente não são retries normais.

## Compatibilidade

A S06 é EXPAND:

- respostas de sucesso permanecem inalteradas;
- `message` continua disponível;
- códigos antigos podem permanecer e são classificados pelo catálogo;
- o frontend `ApiError` passa a preservar category, retryable e correlationId;
- endpoints legados que usam `errorResponse` recebem o envelope S06 automaticamente.

## Fronteiras técnicas

Dropbox é `STORAGE`. D1 e disponibilidade PostGIS são `INFRASTRUCTURE`. Erros semânticos geoespaciais são `SPATIAL`. Falhas de motores de processamento são `ENGINE`.

A categoria é derivada da causa/código, nunca apenas do HTTP status.

## Não escopo

- retry automático global;
- circuit breaker;
- PostGIS real;
- Load Guard;
- novas migrations D1;
- mudança do formato das respostas de sucesso.

## Gates

A suíte S06 valida:

- nove categorias oficiais;
- catálogo com status/retryable;
- envelope `ok:false` completo;
- correlationId no body e header;
- ausência de stack/cause no payload;
- preservação de origem Dropbox/D1 sobre catch-all;
- Result Types;
- contrato `ApiError` do frontend.
