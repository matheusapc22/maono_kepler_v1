# Referencias do controlador de camadas Maono V2

## Origem
Repositorio: matheusapc22/maono_plataforma_v2
Commit: 91ba482622c38a73929ea27e6ec4e11b660eea37

## Destino
Repositorio: matheusapc22/maono_kepler_v1
Branch base de integracao futura: mano_kepler_v1

## Finalidade
Este pacote contem arquivos de referencia para a implementacao do controlador de camadas Maono e dos futuros modos Viewer e Editor.

## Restricoes
- Os arquivos desta pasta nao sao compilados pela aplicacao.
- Nao substituir diretamente arquivos existentes dentro de src.
- Preservar o salvamento atual, o preview assincrono, o MapUrlLoader e as factories do destino.
- Nao copiar o package.json da origem sobre o package.json do destino.
- Autorizacao deve consumir capabilities resolvidas pelo backend, sem decisoes baseadas apenas em role no navegador.
- URLs MVT, datasets de demonstracao e variaveis globais da V2 nao devem entrar na implementacao final.

## Conteudo
- 20 arquivos principais da maono_plataforma_v2.
- SOURCE_COMMIT.txt com o commit fixado.
- package.json armazenado apenas em package-reference.
- SHA256SUMS.txt sera gerado para verificacao de integridade.

## Proxima etapa
Adaptar seletivamente bridge, hooks, painel, layout e estilos, sem sobrescrever o Kepler atual.


## Excecao de fidelidade
O comando git diff --cached --check identifica espacos ao final de linhas em seis arquivos copiados da origem:
- source/src/components/FilterPanel.tsx
- source/src/components/MapOverlayControls.tsx
- source/src/components/Topbar.tsx
- source/src/hooks/useKeplerController.ts
- source/src/index.css
- source/src/pages/Kepler/index.tsx

Esses espacos foram preservados intencionalmente para manter os arquivos binariamente identicos ao commit de origem. Eles deverao ser normalizados somente durante a futura adaptacao para o runtime, nunca dentro deste pacote de referencia.
