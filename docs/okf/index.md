---
type: index
---

# Índice do bundle de conhecimento (OKF)

Este bundle documenta **o que existe** no domínio do projeto: modelo de
dados, protocolo de sync, segurança, UI adaptativa e decisões
arquiteturais. Formato: [Open Knowledge Format](https://github.com/GoogleCloudPlatform/openknowledgeformat)
(Markdown + frontmatter YAML). Regras de conformidade em
[SPEC.md §8.1](/SPEC.md#81-conhecimento-do-domínio-em-okf) e validação em
[`scripts/check-okf.sh`](/scripts/check-okf.sh).

Para **como** o agente deve se comportar no repo, ver [AGENTS.md](/AGENTS.md).
Para a especificação-fonte completa, ver [SPEC.md](/SPEC.md).

## Conceitos

| Conceito | Tipo | Resumo |
|----------|------|--------|
| [environment.md](concepts/environment.md) | `architecture-decision` | Por que NixOS/Nix é o ambiente de dev obrigatório; Android SDK via flake input do GitHub |
| [architecture.md](concepts/architecture.md) | `architecture-decision` | Camadas do app (UI → domínio → store local → sync engine → transporte Nostr) e o princípio "UI só fala com o store local" |
| [data-model.md](concepts/data-model.md) | `data-model` | SQLite + `sqlite_crdt`, HLC, LWW por campo, tombstones, SQLCipher |
| [sync.md](concepts/sync.md) | `architecture-decision` | Por que Nostr como transporte burro; fluxo de push/pull; snapshots vs changesets |
| [protocol.md](concepts/protocol.md) | `protocol` | Kinds Nostr, payload protobuf, versionamento de schema (espelha `shared/PROTOCOL.md`) |
| [security.md](concepts/security.md) | `security` | Gestão de chaves por plataforma, NIP-44, modelo de confiança dos relays |
| [ui-adaptive.md](concepts/ui-adaptive.md) | `architecture-decision` | Breakpoints, navegação por form factor, requisitos de UX mobile/tablet/desktop |
| [theming.md](concepts/theming.md) | `architecture-decision` | Sistema de tokens de tema, Material You, light/dark obrigatórios |
| [i18n.md](concepts/i18n.md) | `architecture-decision` | i18n desde a fundação (pt/en), `.arb`, nunca string hardcoded |
| [performance.md](concepts/performance.md) | `architecture-decision` | Orçamentos de performance e como os scripts de checagem os aplicam |
| [testing.md](concepts/testing.md) | `testing` | Onde cada camada de teste vive, convenção de nomes, armadilha `pumpAndSettle()` × spinner indeterminado |
| [tasks.md](concepts/tasks.md) | `process` | Rastreamento de trabalho pendente em dois níveis: `TODO(fase-N)`/`"Fase N"` no código + arquivos por fase em [`tasks/`](tasks/index.md) |
| [scaffolding.md](concepts/scaffolding.md) | `process` | Automação orientada a agente: geradores determinísticos (tela, feature de dados, conceito OKF, chave i18n) + `verify.sh` (gate de conclusão que espelha o CI) — caminho preferencial em vez de escrever/checar à mão |

## Tarefas por fase

Progresso por fase (SPEC §17) em [`tasks/index.md`](tasks/index.md) — um
arquivo por fase com checklist e status.

## Arquivos reservados

- `index.md` — este arquivo.
- `log.md` — histórico de curadoria do conhecimento (o que mudou e por quê).
