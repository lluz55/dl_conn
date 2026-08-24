---
type: process
---

# Rastreamento de tarefas (fases de implementação)

## Decisão

O trabalho pendente é rastreado em dois níveis, amarrados às 6 fases de
implementação definidas em [SPEC §17](/SPEC.md#17-fases-de-implementação):

| Fase | Nome | Escopo |
|------|------|--------|
| 1 | Fundação | `flake.nix` + devShells; app Flutter com nav adaptativa; lista de exemplo só local |
| 2 | Store local | `sqlite_crdt` + SQLCipher; CRUD com merge CRDT |
| 3 | Cripto e chaves | Geração de chave, storage seguro por plataforma, NIP-44, NIP-07/46 na web |
| 4 | Sync engine | Publicação/recepção de changesets + snapshots; pool de relays; bootstrap |
| 5 | Go CLI | Protobuf compartilhado + comandos de backup/export/import |
| 6 | Polimento | Performance (isolates, batching, renderer web), testes de interop, CI, documentação |

1. **Granular, inline no código:** `TODO(fase-N, ...)` em Dart, comentário ou
   erro contendo `"Fase N"` em Go, no ponto exato do código onde falta
   trabalho.
2. **Por fase, em [`docs/okf/tasks/`](/docs/okf/tasks/index.md):** um arquivo
   por fase (`01-fundacao.md` … `06-polimento.md`) com escopo, checklist de
   sub-tarefas e `status` (`done`/`in-progress`/`pending`) no frontmatter.
   [`docs/okf/tasks/index.md`](/docs/okf/tasks/index.md) resume o progresso
   de todas as fases numa tabela.

Os dois níveis devem ficar sincronizados: ao resolver um `TODO(fase-N)`,
remova o marcador do código **e** marque a sub-tarefa correspondente como
concluída no arquivo da fase em `docs/okf/tasks/`.

## Onde isso vive no código

`scripts/list-todos.sh` agrupa por fase todo o trabalho pendente marcado
(`grep -rnE "[Ff]ase[ -]?N"` em `app/`, `cli/`, `shared/`) — útil para
conferir se um arquivo de tarefa em `docs/okf/tasks/` ainda bate com o
código:

```bash
scripts/list-todos.sh          # lista as ocorrências, agrupadas por fase
scripts/list-todos.sh --count  # só a contagem por fase
```

## Erros comuns de agente

- **Não deixar os dois níveis divergirem.** Marcar uma sub-tarefa como
  concluída em `docs/okf/tasks/0N-*.md` sem remover o `TODO(fase-N)`
  correspondente (ou vice-versa) é o jeito mais fácil de o rastreamento
  virar ruído não confiável.
- **Não remover um marcador `TODO(fase-N)`/`"Fase N"` sem de fato implementar
  o que ele descreve.**
- **Não escrever teste real contra um stub `Unimplemented*`** de uma fase
  futura — teste o contrato/interface, não a implementação stub (ver
  [testing.md](testing.md)).
- Antes de marcar uma fase inteira como `done` em
  `docs/okf/tasks/index.md`, confirme com `scripts/list-todos.sh --count`
  que não sobrou ocorrência daquele número de fase.

## Relacionado

[docs/okf/tasks/index.md](/docs/okf/tasks/index.md),
[architecture.md](architecture.md), [testing.md](testing.md),
[performance.md](performance.md).
