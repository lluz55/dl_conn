---
type: process
---

# Rastreamento de tarefas (fases de implementação)

## Decisão

O trabalho pendente é rastreado em dois níveis, amarrados às fases de
implementação definidas no roteiro em
[`tasks/index.md`](../tasks/index.md):

| Nível | Onde | Formato |
|-------|------|---------|
| Inline no código | `TODO(fase-N, ...)` em Go, comentário ou string; `"Fase N"` em `web/` | marcador de trabalho ainda não feito |
| Por fase | [`tasks/NN-*.md`](../tasks/) | um arquivo por fase com checklist e status |

O roteiro completo (14 fases) vive em
[`tasks/index.md`](../tasks/index.md) e é a fonte de verdade do progresso.

## Fases (resumo; detalhe em `tasks/`)

| # | Fase | Arquivo | Status |
|---|------|---------|--------|
| 1 | Fundação e Configuração Nix | `01-fundacao.md` | concluída |
| 2 | Gerenciador de Túnel Cloudflare | `02-tunnel-manager.md` | concluída |
| 3 | Sinalização Nostr & NIP-44 | `03-nostr-signaling.md` | concluída |
| 4 | Gatekeeper Auth & Proxy Reverso | `04-auth-proxy.md` | concluída |
| 5 | Frontend Estático (SPA web) | `05-frontend-ghpages.md` | concluída |
| 6 | Módulo NixOS, SOPS & E2E | `06-nixos-e2e.md` | concluída |
| 7 | Diagnóstico e Teste de Relays | `07-relay-testing.md` | concluída |
| 8 | Cofre Cifrado de Sessão | `08-session-vault-auth.md` | concluída |
| 9 | QR do keygen para login | `09-keygen-qr-login.md` | concluída |
| 10 | Sessão efêmera no login por nsec | `10-nsec-session-start.md` | concluída |
| 11 | Autorizar npubs em execução | `11-runtime-npub-authorization.md` | concluída |
| 12 | Serviço verde só após atividade | `12-service-health-status.md` | concluída |
| 13 | `keygen files` (npub/nsec) | `13-keygen-files.md` | concluída |
| 14 | Telemetria completa do host | `14-host-telemetry.md` | concluída |

## Convenções

- Cada sub-tarefa é um item de checklist Markdown (`- [ ]` / `- [x]`).
- Cada fase tem critérios claros de "Definição de Concluído" e testes de
  verificação empírica (ver [testing.md](testing.md),
  [scaffolding.md](scaffolding.md)).
- Ao terminar uma fase, marque o checklist e atualize o status em
  `tasks/index.md`.

Relacionado: [architecture.md](architecture.md), [scaffolding.md](scaffolding.md).
