---
type: index
title: "Índice de Tarefas (movido)"
description: "Ponteiro para o bundle canônico de tarefas, em docs/okf/tasks/."
timestamp: 2026-10-26T00:00:00Z
---

# Índice de Tarefas — movido

Este diretório **não é mais o local canônico** das tarefas do `dl_conn`. O
conhecimento do projeto vive no bundle OKF, conforme o `AGENTS.md`, e o índice
autoritativo está em:

- **[docs/okf/tasks/index.md](../okf/tasks/index.md)**

Os arquivos de fases 1–8 que restam aqui são cópias antigas das fases
homônimas em `docs/okf/tasks/`; os de segurança, performance e usabilidade
(foram `15-…` a `20-…` aqui) já foram movidos para lá com prefixo de trilha:

| Era aqui      | Está em                                                  |
|---------------|----------------------------------------------------------|
| `15-security-hardening.md`  | `docs/okf/tasks/s15-security-hardening.md`  |
| `16-security-auth-advanced.md` | `docs/okf/tasks/s16-security-auth-advanced.md` |
| `17-perf-binary-web.md`     | `docs/okf/tasks/p17-perf-binary-web.md`     |
| `18-perf-hotpath.md`        | `docs/okf/tasks/p18-perf-hotpath.md`        |
| `19-usability-discovery.md` | `docs/okf/tasks/u19-usability-discovery.md` |
| `20-usability-mobile-prf.md`| `docs/okf/tasks/u20-usability-mobile-prf.md`|

O prefixo existe porque a numeração solta já estava ocupada no bundle canônico:
lá, a fase 15 é o redesign do SPA e a 16 é o de serviços personalizados, ambas
concluídas. Sem o prefixo, o repositório teria duas tabelas de fases
contraditórias.

**Próximo passo sugerido:** apagar este diretório e as cópias das fases 1–8,
já que o bundle em `docs/okf/tasks/` é a fonte da verdade. Isso é uma remoção de
arquivos versionados e por isso continua pendente de decisão explícita.
