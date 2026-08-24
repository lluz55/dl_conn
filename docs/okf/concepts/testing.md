---
type: testing
---

# Convenção de testes

## Decisão

Testes ficam ao lado do que testam, por camada — sem um diretório
`integration/` separado ainda (SPEC §16 prevê testes de integração do fluxo
de sync quando a Fase 4 estiver implementada).

| Camada | Onde | Convenção |
|--------|------|-----------|
| Domínio/dados (Dart) | `app/test/data/` | `*_test.dart`, um arquivo por classe testada (ex.: `item_local_repository_test.dart` para `ItemLocalRepository`) |
| Widgets/UI (Dart) | `app/test/widget/` | `testWidgets`, nomeia o cenário em português (ex.: `'medium (tablet) mostra NavigationRail'`) |
| Sync/rede (Dart) | `app/test/sync/` | Sem WebSocket real: injeta um `channelFactory` fake em `RelayPool` (ver `relay_pool_test.dart`) — mesma técnica se aplicar a `SyncEngine`/`Nip44Cipher`/`EventVerifier` quando saírem de `Unimplemented*` |
| CLI (Go) | ao lado do pacote, `*_test.go` | `TestFuncName` padrão Go; roda via `go test ./...` |
| Paridade de protocolo (constantes) | `scripts/check-protocol-parity.sh` | Compara `kinds.dart`↔`kinds.go` por nome/valor — roda no CI, não precisa de `flutter test`/`go test` |
| Interop Dart↔Go (payload) | ainda não existe | SPEC §16 pede um teste que gera `Changeset` em Dart, decifra/decodifica em Go (e vice-versa) — criar junto com a Fase 4/5 (protobuf + NIP-44 reais), não antes |

## Armadilha: `pumpAndSettle()` com spinner indeterminado

`ShowcaseScreen` mostra um `AppExpressiveLoadingIndicator` (`package:dl_concept`)
enquanto `itemsProvider` não emite o primeiro valor. Como qualquer spinner
indeterminado (`AnimationController` com `repeat(reverse: true)`, ticker que
nunca para sozinho), qualquer árvore de widgets que o contenha faz
`tester.pumpAndSettle()` travar indefinidamente até estourar timeout, mesmo
que os dados por trás resolvam rápido. Não é deadlock do app: é
incompatibilidade conhecida entre spinners indeterminados e
`pumpAndSettle()`.

Em `app/test/widget/adaptive_nav_test.dart`, a shell de navegação (o que o
teste verifica) já está montada e estável bem antes do primeiro valor do
`itemsProvider` chegar — a correção foi trocar `pumpAndSettle()` por alguns
`pump()` com frames explícitos, sem esperar o spinner sumir. Regra geral:
**nunca `pumpAndSettle()` numa árvore que pode conter um indicador de
progresso indeterminado** — pump explícito, ou espere por um finder
específico do que o teste realmente precisa (não pelo "settle" da árvore
inteira).

## Armadilha: `sqflite_common_ffi` trava em `testWidgets` mesmo com `runAsync()`

`AppDatabase.open/openInMemory` usa `sqflite_common_ffi`, que resolve toda
consulta num **isolate real** em segundo plano (mesmo para `:memory:`).
Isso funciona sem problema em `test()` puro/async
(`item_local_repository_test.dart` prova isso — `await
repository.watchAll().first` resolve normalmente). Mas **dentro de
`testWidgets()`**, mesmo trocando `tester.pump()` por `tester.pump()`
repetido ou por `tester.runAsync()`, a stream de `itemsProvider` pode nunca
emitir — trava até o timeout do teste (10min), sem exceção nenhuma. É uma
incompatibilidade conhecida entre a comunicação entre isolates do
`sqflite_common_ffi` e o binding de teste do Flutter (`dart:isolate
_RawReceivePort._handleMessage` aparece no stack trace do timeout).

**Não tente contornar isso tentando esperar mais** (mais `pump()`,
`runAsync()` maior, delay maior) — não resolve, só desperdiça tempo de
diagnóstico. Para testar um widget que depende de uma `StreamProvider`
sobre um repositório real, **teste contra um fake do repositório**
(`Stream` local, sem `sqflite`) via `overrideWithValue` — ver
`app/test/widget/showcase_screen_test.dart` (`_FakeItemRepository`). Reserve
o banco real (`AppDatabase.open/openInMemory`) para os testes de
`app/test/data/`, que já não têm esse problema por não passarem por
`testWidgets`.

## Onde isso vive no código

`scripts/perf-check.sh` não roda testes (isso é `dart analyze`/`flutter
test`/`go test`, ver `AGENTS.md` → Comandos). `scripts/list-todos.sh` ajuda a
achar código ainda stub (`TODO(fase-N`) que não vale a pena testar de verdade
ainda — teste o contrato/interface (`Nip44Cipher`, `EventVerifier`), não a
implementação `Unimplemented*`.

Relacionado: [architecture.md](architecture.md), [performance.md](performance.md).
