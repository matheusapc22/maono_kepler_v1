# Catálogo de fixtures históricas - S00

A S00 congela o **catálogo** de mapas que deverá se tornar o corpus de Golden Maps da arquitetura Maõno.

Nesta etapa não são copiados dados de produção nem payloads sensíveis. O arquivo `manifest.json` define os cenários mínimos que precisam ser preservados ao longo das migrations e atualizações de engine.

## Política

- Não usar dados reais de clientes.
- Fixtures futuras devem ser sanitizadas e determinísticas.
- Cada fixture deverá informar schema/version, objetivo, invariantes e origem sintética.
- Alterações futuras no formato persistente deverão manter ou migrar semanticamente esse corpus.

## Estado atual

`catalog_frozen`: o conjunto de cenários está definido, mas a captura dos JSONs canônicos será realizada junto da implementação de Golden Maps/Migration Registry. Isso evita fabricar configs supostamente válidas sem antes formalizar o schema `maono-map`.
