---
type: architecture-decision
---

# Sincronização via Nostr

## Decisão

Nostr é tratado como **transporte burro e não confiável**: todo payload é
assinado e cifrado; nenhum relay é fonte de verdade. Dois tipos de evento:

- **Snapshot** (kind `30078`, NIP-78, addressable): estado completo
  compactado, cifrado. Só o mais recente é mantido.
- **Changeset** (kind regular `9411`, `TEMPLATE_CHANGESET_KIND`): deltas
  incrementais desde o snapshot.

**Push:** mutação local → changeset (deltas HLC) → serializado (protobuf) →
cifrado (NIP-44 v2, auto-cifra) → publicado. Periodicamente, um novo
snapshot é publicado e changesets antigos podem ser podados (NIP-09).

**Pull (bootstrap):** cliente novo pede o último snapshot do próprio
`pubkey`, depois changesets desde o timestamp do snapshot; decifra, valida
assinatura, aplica no store local (merge CRDT idempotente); mantém
subscrição ativa para deltas em tempo real.

## Por quê

- Sem servidor central obrigatório — sincroniza entre os dispositivos do
  próprio usuário via relays públicos/privados.
- Merge idempotente (CRDT) tolera relays não confiáveis, reordenação e
  duplicação de eventos.

## Onde isso vive no código

`app/lib/sync/` (sync engine, cliente Nostr, pool de relays), espelhado em
`cli/internal/` para a CLI Go (`pull`/`push`/`backup`).

Relacionado: [protocol.md](protocol.md) (schema exato), [security.md](security.md)
(cifra e modelo de confiança).
