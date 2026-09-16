---
type: task
title: "Fase 16 — Serviços personalizados no frontend"
status: done
---

# Fase 16 — Serviços personalizados no frontend

Permitir que um usuário autenticado cadastre atalhos temporários para serviços
HTTP no loopback do host e transforme esses cadastros em configuração
permanente explícita, sem alterar o protocolo Nostr nem a configuração do
daemon em runtime.

- [x] Formulário responsivo no cartão Serviços com nome e porta obrigatórios,
      descrição opcional, seletor limitado aos ícones seguros já vendorizados,
      opção WebSocket e persistência local opt-in (desmarcada por padrão)
- [x] Acesso temporário pelo proxy autenticado existente
      `/local/<porta>/`, com aviso explícito de que essa rota é HTTP-only e de
      que WebSocket só vale para a configuração permanente exportada
- [x] Schema local versionado `dl_conn_custom_services_v1`; apenas entradas com
      opt-in sobrevivem ao reload, enquanto entradas temporárias permanecem só
      em memória
- [x] Merge entre descoberta do host e serviços personalizados sem sobrescrever
      serviços configurados; IDs/prefixos permanentes são normalizados e
      desambiguados
- [x] Cartões personalizados identificados como temporários/salvos e como não
      sondados; remoção atua somente sobre a coleção personalizada
- [x] Exportação de fragmentos **somente de serviços personalizados** em YAML
      (`services:` para `config.yaml`) e Nix (lista para
      `services.dl-conn.settings.services`) com os campos canônicos
      `id/name/icon/description/prefix/target/stripPrefix/websocket`
- [x] Serialização segura de strings em YAML e Nix; alvo permanente fixo em
      `http://127.0.0.1:<porta>`
- [x] Testes standalone da lógica de produção e testes estruturais de UI,
      somados à suíte web completa
- [x] Conceito de layout e log OKF atualizados

## Done when

- Serviços personalizados temporários sobrevivem a novas respostas de
  descoberta, mas não a reload; os persistidos sobrevivem a ambos.
- Uma colisão de nome/ID com serviço do host nunca substitui a entrada do host.
- Os downloads YAML e Nix incluem somente entradas personalizadas e são
  apresentados como fragmentos para merge, sem chaves Nostr ou outras seções.
- Toda a suíte `web/tests/*.js` passa e `scripts/check-okf.sh` valida o bundle.
