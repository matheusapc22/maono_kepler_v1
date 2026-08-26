# Modo operacional imediato — dados geoespaciais manuais

## Objetivo

Manter a Maõno operacional agora, antes do Spatial Data Plane/PostGIS definitivo, com uma rotina simples e reversível para dados manuais.

## Formatos suportados nesta fase

### GeoJSON / JSON / CSV / Arrow / Parquet

Usar **Adicionar dados → Upload** do Kepler. O hotfix de carregamento de projetos grandes reduz cópias redundantes do MapConfig ao reabrir um projeto salvo.

### Vector Tiles

Usar **Adicionar dados → Tileset**. A versão atual do Kepler utilizada pela Maõno (`3.1.x`) suporta Vector Tile/MVT e PMTiles. Para bases muito grandes e estáveis, esta é a representação preferida já nesta fase operacional.

### Shapefile

O Kepler 3.1 não possui ingestão nativa de Shapefile no uploader padrão utilizado pela Maõno. Até existir um importador SHP próprio, o procedimento operacional é:

1. abrir o `.shp`/`.zip` no QGIS;
2. executar `Fix geometries` quando necessário;
3. reprojetar para WGS84 / EPSG:4326;
4. exportar como GeoJSON para datasets pequenos/médios, ou gerar/publicar PMTiles para datasets grandes;
5. carregar o resultado pela opção Upload ou Tileset da Maõno;
6. salvar o projeto normalmente.

Esse passo é deliberadamente manual e temporário. Não será levado para a arquitetura final do Spatial Data Plane.

## Regra prática de operação

- Preferir GeoJSON para edição/experimentação e volumes moderados.
- Preferir PMTiles/MVT para bases grandes, estáveis e majoritariamente de leitura.
- Evitar salvar cópias duplicadas da mesma camada no mesmo projeto.
- Manter o CRS em EPSG:4326 antes da ingestão.
- Para GeoJSON pesado, testar a abertura e o save/reload no projeto de homologação antes de promover para uso diário.

## O que este hotfix muda

- adiciona endpoint autenticado de streaming do MapConfig publicado;
- evita que o Worker faça download → ArrayBuffer → JSON.parse → JSON.stringify do projeto inteiro em cada abertura;
- o navegador consome diretamente os bytes do MapConfig publicado;
- projetos Kepler v1 grandes usam hidratação leve, evitando `KeplerGlSchema.load` redundante;
- projetos salvos deixam de pedir `centerMap: true`, evitando recalcular bounds sobre todas as features quando o viewport já está persistido;
- retries continuam apenas para falhas HTTP/rede transitórias; JSON inválido não é reprocessado repetidamente.

## O que este hotfix não muda

- não cria PostGIS;
- não cria Dataset Registry;
- não externaliza datasets do MapConfig;
- não cria geração automática de PMTiles;
- não adiciona importador SHP nativo;
- não altera permissões, lifecycle, revisão imutável ou save atômico;
- não substitui a Performance Safety Plane nem define threshold final de bloqueio.

## Critério de homologação

Validar pelo menos:

1. projeto pequeno existente;
2. projeto `demo` que hoje falha;
3. GeoJSON de ~10–20 MiB;
4. GeoJSON de ~40 MiB;
5. um PMTiles/MVT remoto;
6. save → fechar → reabrir;
7. Viewer e Editor;
8. retry após falha de rede transitória;
9. projeto com JSON inválido deve falhar uma vez, sem loop de retry de parse.
