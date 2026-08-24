---
type: architecture-decision
---

# Ambiente de desenvolvimento: NixOS/Nix obrigatório

## Decisão

O ambiente de desenvolvimento canônico deste template é **NixOS** — ou, no
mínimo, Nix ≥ 2.18 com flakes habilitados sobre outra distro/macOS. Toda
toolchain (Flutter, Go, Android SDK/NDK, GTK e demais deps de sistema do
Linux) é fixada em `flake.lock`. Nenhum comando de build/lint/teste deve
rodar com toolchains instaladas manualmente fora do Nix.

O Android SDK/NDK vem de um **flake input dedicado hospedado no GitHub**,
[`github:tadfisher/android-nixpkgs`](https://github.com/tadfisher/android-nixpkgs),
e não do `androidenv` cru do nixpkgs nem de instalação manual (Android
Studio/`sdkmanager`). Versões de build-tools/platform/NDK são pinadas
explicitamente em `flake.nix`.

## Por quê

- **Reprodutibilidade real:** elimina "funciona na minha máquina" — dev e CI
  usam exatamente os mesmos pacotes/versões.
- **Isolamento:** nada é instalado globalmente no host.
- **Licenciamento do Android SDK:** exige `nixpkgs.config.allowUnfree = true`
  explícito — decisão consciente, não acidental.

## Onde isso vive no código

- `flake.nix`: inputs `nixpkgs`, `flake-utils`, `android-nixpkgs`; devShells
  `app-linux`, `android`, `cli`.
- `.envrc`: `use flake` (integração opcional com direnv).

## Detalhes e trade-offs

Ver [SPEC.md §13](/SPEC.md#13-ambiente-de-desenvolvimento-e-flakenix) para o
texto normativo completo, incluindo a honestidade sobre por que um APK
100% reprodutível em Nix não é o padrão do template (o build do APK roda via
`flutter build apk` dentro do devShell `android`, não como `nix build`).

Relacionado: [architecture.md](architecture.md).
