---
type: architecture-decision
---

# UI adaptativa: mobile, tablet e desktop

## Decisão

A experiência deve ser boa em **celular, tablet e desktop** — não apenas
"não quebrar". Cada breakpoint Material 3 é um alvo de UX de primeira
classe:

| Faixa | Largura | Dispositivo típico | Navegação |
|-------|---------|---------------------|-----------|
| Compact | < 600dp | Celular | `NavigationBar` |
| Medium | 600–840dp | Tablet retrato / janela pequena de desktop | `NavigationRail` |
| Expanded | > 840dp | Tablet paisagem / desktop | `NavigationDrawer` |

Uma shell de navegação única (`go_router` `ShellRoute`) decide o componente
via `MediaQuery`/`LayoutBuilder`, preservando estado das abas. Alvos de
toque ≥ 48×48dp em compact/medium; em expanded/desktop, suporte a
mouse/teclado (hover, foco visível, atalhos, scroll). Nenhuma
funcionalidade exclusiva de um form factor.

## Por quê

O template visa três plataformas de primeira classe (Android, Linux, Web) —
cada uma coexiste com múltiplos form factors reais (celular Android, tablet
Android, janela Linux redimensionável, browser em qualquer largura). Tratar
um breakpoint como "principal" e os outros como fallback degrada a UX nas
plataformas não-priorizadas.

## Onde isso vive no código

Pacote `packages/dl_concept/` (`lib/src/nav/` — shell adaptativa,
`lib/src/theme/`), consumido pelo app via `package:dl_concept` em
`app/lib/ui/router.dart`. Testado com testes de unidade e widget tests
próprios em `packages/dl_concept/test/`; o app cobre a integração completa
em `app/test/widget/adaptive_nav_test.dart`.

Relacionado: [architecture.md](architecture.md).
