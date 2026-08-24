---
type: architecture-decision
---

# Arquitetura em camadas

## Decisão

A UI **só fala com o store local**. A sincronização é assíncrona e roda em
segundo plano. O app é totalmente funcional offline. Camadas, de cima para
baixo:

1. **UI (Flutter):** `app/lib/ui/` — telas, navegação adaptativa, providers
   Riverpod. Nunca acessa a rede ou o Nostr diretamente.
2. **Domínio:** `app/lib/domain/` — modelos e casos de uso, sem dependência
   de Flutter nem de infraestrutura (SQLite, Nostr).
3. **Store local:** `app/lib/data/` — `sqlite_crdt` + SQLCipher. Fonte de
   verdade da UI.
4. **Sync engine:** `app/lib/sync/` — traduz changesets/snapshots locais em
   eventos Nostr cifrados (NIP-44) e vice-versa.
5. **Transporte Nostr:** pool de relays (WebSocket), assinatura, filtros —
   dentro de `app/lib/sync/nostr/`.

## Por quê

- Resposta de UI imediata (< 16ms, ver [performance.md](performance.md)) sem
  depender de latência de rede.
- Testabilidade: domínio e store local são testáveis sem mocks de rede.
- Troca de transporte (ex.: trocar Nostr por outra coisa) fica isolada em
  `sync/`, sem tocar UI/domínio.

## Onde isso vive no código

Ver `app/lib/{ui,domain,data,sync,crypto}/`. O scaffold de referência (lista
de itens local, CRUD) exercita todas as camadas — ver
[data-model.md](data-model.md) e [sync.md](sync.md).

Relacionado: [environment.md](environment.md), [ui-adaptive.md](ui-adaptive.md).
