---
type: process
---

# Automação: geradores e gate de verificação

## O que é

Um conjunto de scripts em `scripts/` que automatiza os padrões repetitivos do
repo de forma **determinística e não-interativa**, otimizado para consumo por
**agente LLM**. São o caminho preferencial — tanto para humano quanto para
agente — de criar tela, feature de dados, conceito OKF ou string de UI, e de
verificar se uma tarefa está concluída.

## Por que existe (o ganho não é digitar menos)

Para um agente, o valor não é velocidade de digitação — é **eliminar variância**
e **nascer dentro da "definição de concluído"**. Escrita livre erra sempre nas
mesmas coisas que este repo exige (i18n pt+en, tokens de tema, camadas,
`ConsumerWidget`, teste). A pesquisa de 2026 é clara: *o gargalo dos agentes não
é gerar código, é **verificar** código* — por isso o item de maior alavancagem é
o gate `verify.sh`, não outro gerador.

## Geradores e verificação

| Script | Cria/faz | Toca arquivo existente? |
|--------|----------|--------------------------|
| [`scripts/verify.sh`](/scripts/verify.sh) | **Gate de conclusão**: espelha o CI (format+analyze+testes+segredos+anti-padrões+OKF+protocolo+Go) num comando; `--full` adiciona builds de tamanho | — (só lê) |
| [`scripts/new-screen.sh`](/scripts/new-screen.sh) | Tela adaptativa: `ConsumerWidget` + i18n pt/en + teste | Imprime snippet de rota (não edita router) |
| [`scripts/new-repository.sh`](/scripts/new-repository.sh) | Feature de dados: entidade + porta + impl. CRDT local + teste (field spec tipado) | Imprime CREATE TABLE + wiring de providers |
| [`scripts/new-concept.sh`](/scripts/new-concept.sh) | Conceito OKF com frontmatter válido + registro no `index.md` | Edita `index.md` (append de linha) |
| [`scripts/add-l10n.sh`](/scripts/add-l10n.sh) | Uma chave i18n nos **dois** `.arb` (simetria pt/en) | Edita os dois `.arb` |

Padrões comuns dos geradores: só flags (nada no stdin), idempotentes, fail-loud
(abortam sem escrever se o alvo já existe), e a saída Dart passa
`dart analyze --fatal-infos` e é no-op sob `dart format`. Onde um ponto de
integração envolve **decisão** (rota, versão de schema/migração), o gerador
**imprime** o snippet em vez de auto-editar — o mesmo princípio do router em
`new-screen.sh`.

## Ordem de uso típica (agente)

1. `new-screen.sh` / `new-repository.sh` gera os arquivos.
2. Cola os snippets impressos (rota / CREATE TABLE + providers).
3. `add-l10n.sh` para strings extras; `(cd app && flutter pub get)` regenera o l10n.
4. **`scripts/verify.sh`** — só considere a tarefa concluída quando ficar verde.

## Erros comuns de agente

- **Escrever à mão "porque é rápido".** Use o gerador; é o que garante i18n nos
  dois `.arb`, tokens de tema e camadas corretas.
- **Concluir sem rodar `verify.sh`.** É o gate de "definição de concluído"; um
  teste vermelho gerado (ex.: `new-repository.sh` antes de wirar o schema) é o
  seu checklist, não um bug.
- **Esquecer os snippets impressos.** A tela não roteia e a tabela não existe
  até você colar o que o gerador imprimiu.
- **`new-repository.sh` e schema:** adicionar a tabela ao `_onCreate` pode exigir
  bump de `_schemaVersion` + migração para instalações existentes — ver
  [data-model.md](data-model.md).

## Referências

Convenções que os geradores materializam: [i18n.md](i18n.md),
[theming.md](theming.md), [ui-adaptive.md](ui-adaptive.md),
[architecture.md](architecture.md), [data-model.md](data-model.md),
[testing.md](testing.md). Rastreamento: [tasks.md](tasks.md).
