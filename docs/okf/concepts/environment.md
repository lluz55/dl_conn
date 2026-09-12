---
type: architecture-decision
---

# Ambiente de desenvolvimento: NixOS/Nix obrigatório

## Decisão

O ambiente de desenvolvimento canônico deste projeto é **NixOS** — ou, no
mínimo, Nix ≥ 2.18 com flakes habilitados sobre outra distro/macOS. Toda
toolchain (Go, golangci-lint, gopls, cloudflared, git) é fixada em
`flake.lock`. Nenhum comando de build/lint/teste deve rodar com toolchains
instaladas manualmente fora do Nix.

O **único** binário externo que o daemon executa em runtime é o `cloudflared`,
que vem de nixpkgs (`pkgs.cloudflared`) e é injetado no `PATH` do binário via
`wrapProgram` em `dl-conn.nix` — o host não deve fornecê-lo.

## Por quê

- **Reprodutibilidade real:** elimina "funciona na minha máquina" — dev e CI
  usam exatamente os mesmos pacotes/versões.
- **Isolamento:** nada é instalado globalmente no host.
- **Licenciamento:** `cloudflared` traz obrigações de licença; fixá-lo no Nix é
  uma decisão consciente, não acidental.

## Onde isso vive no código

- `flake.nix`: inputs `nixpkgs`, `flake-utils`; `devShells.default` com Go,
  gopls, golangci-lint, cloudflared, git; `packages.default`/`apps.default`
  constrói `dl_conn` via `dl-conn.nix`.
- `dl-conn.nix`: `buildGoModule` (version `0.1.0`, `subPackages: cmd/dl_conn`,
  `vendorHash` fixo), `nativeBuildInputs: [cloudflared makeWrapper]`, `wrapProgram`
  injetando o `cloudflared` no `PATH`.
- `.envrc` (opcional): `use flake` para integração com direnv.

## Detalhes e trade-offs

Ver [README.md](/README.md#desenvolvimento) para o texto normativo de comandos
(`nix develop`, `go build ./cmd/dl_conn`, `go test ./internal/...`) e
[AGENTS.md](/AGENTS.md) para as convenções de lint/teste.

Relacionado: [architecture.md](architecture.md), [security.md](security.md).
