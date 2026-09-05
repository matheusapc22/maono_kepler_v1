# Viewer — Persistent Visualization Operations

Esta etapa amplia o fluxo de `Solicitar salvamento` do Viewer com três contratos persistíveis:

- `layer.visibility.update@v1`
- `persistent.filter.update@v1`
- `layer.order.update@v1`

Estados transitórios de UI — viewport, pan/zoom, hover, tooltip, seleção e abertura de painéis — permanecem fora da Working Copy.

Filtros sincronizados/multi-dataset ficam fail-closed no contrato v1 porque o Engine Adapter atual não garante replay seguro desse formato. O Viewer continua podendo usá-los localmente, mas a submissão é bloqueada se uma mutação não puder ser representada por um contrato conhecido.

As operações são armazenadas no IndexedDB da Working Copy, restauradas somente após o readiness visual do mapa-base, validadas novamente no backend e aplicadas sequencialmente sobre a proposal. Não há migration nova e o Viewer continua sem `project.save`.
