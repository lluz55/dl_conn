---
type: data-model
---

# Modelo de dados e persistência local

## Decisão

Store SQLite via `sqlite_crdt`. Cada tabela ganha colunas de metadados CRDT
(Hybrid Logical Clock, tombstone). Resolução de conflito:
**last-write-wins por campo**, ordenada por HLC — determinística, sem
coordenação central. Deleção é *soft delete* via tombstone, necessária para
propagar remoções entre dispositivos. O banco é cifrado em repouso com
SQLCipher; a chave deriva de material no storage seguro da plataforma (ver
[security.md](security.md)).

## Scaffold de referência

Tabela `items`: lista simples (criar/editar/apagar) que exercita toda a
plumbing de persistência + CRDT + sync. Campos típicos: `id`, `title`,
`done`, além das colunas HLC/tombstone injetadas pelo `sqlite_crdt`.

## Quando trocar de estratégia

LWW/HLC é suficiente para dados estruturados (listas, campos, flags). Para
**edição colaborativa de texto** com merge de caracteres, migrar a coluna
relevante para um CRDT de sequência (Automerge/Loro via FFI) — fora do
escopo padrão deste template (evita FFI).

## Onde isso vive no código

`app/lib/data/local/` (store + repositórios), `app/lib/domain/` (modelo
`Item`, casos de uso independentes de infraestrutura).

Relacionado: [sync.md](sync.md) (como mudanças viram changesets),
[protocol.md](protocol.md) (schema do changeset).
