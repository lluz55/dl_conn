---
type: testing
---

# Convenção de testes

## Decisão

Testes ficam ao lado do que testam, por camada — sem um diretório `integration/`
separado (quando houver testes de integração de fluxo, vivem junto do pacote).

| Camada | Onde | Convenção |
|--------|------|-----------|
| Daemon — pacotes `internal/*` | `internal/<pkg>/*_test.go` | `TestXxx` padrão Go; roda via `go test ./internal/...` |
| Daemon — entrypoint/CLI | `cmd/dl_conn/*_test.go` | `TestXxx`; cobre sinalização, allowlist, anti-replay, keygen |
| Web SPA | `web/tests/*.js` | scripts standalone rodados com `node` (ES modules); importam os módulos de `web/js/` diretamente |
| Paridade de protocolo | `internal/nostr` | `RequestMessage`/`ResponsePayload` testados contra os valores exatos em `protocol.go`; roda no CI via `go test` |

| Harness de UI | `harness/index.html` + `harness/*.js` | sobe o SPA **real** contra dados falsos; atrás de `--dev-mock-auth` |

## Harness de UI local (`web/dev.html`)

Existe uma quarta camada, que não é um teste: sobe a SPA de verdade contra
sessão, host Nostr e telemetria **falsas**, para trabalhar na interface sem
nsec real, relay real ou túnel no ar.

```bash
nix develop
go run ./cmd/dl_conn --dev-mock-auth
# abrir http://127.0.0.1:9099/dev/
```

Três propriedades que valem preservar:

1. **A propriedade de segurança é o *diretório*, não a flag.** O harness mora
   em `harness/`, **fora de `web/`**. Sem `--dev-mock-auth` o daemon
   responde **404** em `/dev/`, mas isso é defesa em profundidade: com os
   arquivos dentro de `web/` o `proxy.RootFallback` os servia a qualquer
   um, porque `isSPAPath()` só lista `/`, `/index.html`, `/app.js`,
   `/style.css` e `/_static/` — todo *outro* arquivo presente no web dir
   cai no handler estático. Uma rota 404 explícita não corrige isso sozinha: um
   binário compilado antes dela não tem a rota e serve o harness mesmo sem a
   flag. Fora de `web/` não há o que servir, então a garantia vale para
   qualquer binário — e `build/web.tar.gz` é montado a partir de `web/`, de
   modo que código de dev também some do artefato de release. Ver
   [web-frontend-layout.md](web-frontend-layout.md).
2. **Ele fura estado local do browser, não autenticação.** Toda rota real
   continua exigindo cookie de sessão de verdade, então o harness mostra um
   painel mas não alcança serviço, config ou proxy nenhum. A identidade
   placeholder é `k = 1` do secp256k1 (ponto gerador) e nunca é persistida.
3. **Não precisa de nsec nem npub reais.** `startNostr()` aborta enquanto
   `state.config.hostNpub` estiver vazio, e a SPA busca `"./config.json"`
   relativo ao documento — de `/dev/` isso é `/dev/config.json`, servido a
   partir de `harness/config.json`, **não** um alias do `web/config.json`
   real. As chaves são os pontos geradores do secp256k1 para k=1 (identidade
   da sessão) e k=2 (host): bech32 válido, que todo parser do lado do cliente
   aceita, e derivado de nada seu. Verificado boitando o harness contra um
   diretório web sem `config.json` nenhum e procurando no DOM renderizado
   pelas formas bech32 e hex do npub real do host — nenhuma aparece.
4. **Roda sob a mesma CSP do app.** Um import map resolveria o decoupling,
   mas exige `<script type="importmap">` inline e `script-src self` não
   tem `unsafe-inline` — afrouxar isso para a página de dev faria o harness
   parar de provar o que a página real prova. Daí o `patchSessionManager()` /
   `patchNostrClient()` no protótipo: as classes reais, construtores e estado
   privado intactos, só os métodos que a SPA chama substituídos.

O corpo do `dev.html` é puxado de `index.html` em runtime — uma cópia só do
markup, para o harness não divergir do que ele deveria estar testando.
Detalhes e o que **não** é coberto em [harness/README.md](../../../harness/README.md).

## Como rodar

```bash
# Go — todo o daemon
go test ./...

# Go — pacote específico
go test ./internal/nostr/... -run TestAllowlist

# Web — todos os testes JS
node web/tests/crypto_tests.js
node web/tests/session_tests.js
# ou em lote (shell):
for t in web/tests/*_tests.js; do node "$t"; done
```

## Armadilha: `cloudflared` e túnel em testes

O daemon depende do binário externo `cloudflared` para abrir o túnel. Em testes
de `internal/tunnel`, **não** chame o binário real: use um `TunnelManager`
fakenado/interface (ou ajuste o `CloudflaredPath` para um stub) para que o teste
não dependa de rede nem do binário. O mesmo vale para relays Nostr em
`internal/nostr`: injete um transporte fake (ou `go-nostr` relay em memória)
em vez de conectar a relays públicos.

## Onde isso vive no código

`scripts/` (se houver um gate de verificação agregando `go test`, `golangci-lint`
e os testes web) — ver [scaffolding.md](scaffolding.md). A lista de tarefas
ainda stub (`TODO(fase-N)`) é rastreada em [tasks.md](tasks.md).

Relacionado: [architecture.md](architecture.md), [performance.md](performance.md).
