---
type: protocol
---

# Protocolo de payload (changeset/snapshot)

## O que é

Schema protobuf único (`shared/proto/changeset.proto`) com codegen para Dart
e Go, garantindo paridade entre app e CLI. Mensagens: `HybridLogicalClock`,
`FieldChange`, `Changeset`, `SnapshotRow`, `Snapshot`.

Kinds Nostr, convenção de auto-cifra NIP-44 e regras de versionamento de
`schema_version` estão documentados normativamente em
[`shared/PROTOCOL.md`](/shared/PROTOCOL.md) — este arquivo é o resumo
navegável dentro do bundle OKF; **a fonte de verdade é `shared/PROTOCOL.md`**.

## Constantes

| Constante | Valor |
|-----------|-------|
| `TEMPLATE_CHANGESET_KIND` | `9411` |
| `TEMPLATE_SNAPSHOT_KIND` | `30078` |
| `SNAPSHOT_D_TAG` | `tpl-new-app-snapshot` |

## Codegen

`scripts/gen-proto.sh` gera bindings Dart (`app/lib/sync/proto/`, não
versionado) e Go (`cli/internal/protocol/`, não versionado) a partir do
`.proto`.

Relacionado: [sync.md](sync.md), [security.md](security.md) (cifra do
payload).
