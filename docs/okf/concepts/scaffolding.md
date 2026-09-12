---
type: process
---

# Automação e gate de verificação

## O que é

O projeto **não** usa geradores de scaffolding nem um `verify.sh` dedicado: o
stack é pequeno e explícito (Go + web vanilla), então o caminho preferencial é
editar os arquivos diretamente dentro do devShell Nix. A "definição de
concluído" é um conjunto fixo de comandos que espelham o CI.

## Por que existe (e por que não há geradores)

Para um agente, o valor não é gerar código — é **verificar** código. Neste repo
isso significa rodar os checks abaixo e ver tudo verde, não invocar um gerador.
A pesquisa de 2026 é clara: *o gargalo dos agentes não é gerar código, é
verificar código*.

## Comandos de verificação (o gate)

```bash
nix develop                                  # entra no devShell (Go + cloudflared + golangci-lint)

go build ./cmd/dl_conn                       # compila o daemon
go test ./...                                # todos os testes Go
golangci-lint run                            # linters (errcheck, ineffassign, ...)
go vet ./...                                 # vet do Go

for t in web/tests/*_tests.js; do node "$t"; done   # testes do SPA
```

**Só considere a tarefa concluída quando todos estiverem verdes.**

## Convenções comuns

- **Go:** novos pacotes em `internal/<nome>` + `*_test.go` ao lado; novos
  subcomandos Cobra em `cmd/dl_conn`. Sem `init()` surpresa; sem dependência
  de rede em testes (use stubs/fakes — ver [testing.md](testing.md)).
- **Web:** edite `web/js/*.js`, `web/index.html`, `web/style.css`; sem bundler,
  sem framework. Bibliotecas de terceiros só via `web/vendor/` (CSP
  `script-src 'self'`).
- **Nix:** `dl-conn.nix` (`buildGoModule`, `vendorHash`), `flake.nix`
  (devShell/pacote), `nixos/module.nix`. Nunca instale Go/cloudflared fora do Nix.

## Erros comuns de agente

- **Rodar `go`/`golangci-lint` fora do `nix develop`.** Sempre entre no
  devShell; o host não deve ter essas toolchains.
- **Concluir sem rodar os checks.** O gate de "definição de concluído" é o
  comando acima — um teste vermelho (ex.: allowlist em `internal/nostr`) é o seu
  checklist, não um bug.
- **Tocar em `flake.lock`/lockfiles ou `flake.nix` sem necessidade.** Isso
  requer alinhamento prévio (ver AGENTS.md → Boundaries).
- **Adicionar dependência de runtime que não passe na CSP** (CDN/inline/eval no
  web, ou binário não-vendored). O SPA bloqueia qualquer coisa fora `'self'`.

## Referências

Convenções que os checks materializam: [environment.md](environment.md),
[testing.md](testing.md), [security.md](security.md),
[architecture.md](architecture.md). Rastreamento: [tasks.md](tasks.md).
