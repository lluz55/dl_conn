---
type: task
phase: 6
status: pending
title: "Fase 6 — Módulo NixOS, SOPS & Validação E2E"
description: "Módulo NixOS com systemd service, injeção de segredos via SOPS, integração com o host n100 e testes integrados ponta a ponta."
timestamp: 2026-08-23T13:57:00Z
---

# Fase 6 — Módulo NixOS, SOPS & Validação E2E

## Objetivo
Empacotar o daemon `dl_conn` como um módulo NixOS de primeira classe (`nixosModules.default`), integrar ao repositório `/home/lluz/nixos-config` no host `n100`, gerenciar a chave `nsec` de forma segura via SOPS-nix e validar o fluxo completo ponta a ponta.

## Sub-tarefas

- [ ] **Módulo NixOS Declarativo (`nixos/module.nix` ou exportado via `flake.nix`):**
  - Opções `services.dl-conn.enable`, `services.dl-conn.configFile` / `services.dl-conn.settings`.
  - Opção para secret file do `nsec` (`services.dl-conn.secretFile`).
  - Criação do serviço `systemd.services.dl-conn` com `DynamicUser = true` ou usuário dedicado, `after = [ "network-online.target" ]`, `Restart = "always"`.
  - Inclusão automática do binário `cloudflared` no `PATH` do serviço.
- [ ] **Integração de Segredos com SOPS-nix:**
  - Configuração do segredo Nostr (ex: `sops.secrets."nostr/dl-conn-key"`) no host `n100`.
  - Garantir que o daemon leia a chave do caminho do segredo em runtime sem expor chaves no Nix Store público.
- [ ] **Integração no `hosts/n100/default.nix`:**
  - Adicionar input do flake `dl_conn` no `/home/lluz/nixos-config/flake.nix`.
  - Declarar `services.dl-conn` no `hosts/n100/default.nix` mapeando os serviços reais:
    - Home Assistant (`10.0.66.1:8123`)
    - Frigate (`10.0.66.1:5000`)
    - Zigbee2MQTT (`10.1.1.10:8080`)
- [ ] **Testes de Integração & Estresse:**
  - Teste de reconexão do túnel após queda de rede simulada.
  - Teste de concorrência com múltiplas requisições simultâneas via túnel.
  - Teste de fluxo de vídeo e WebSockets no Frigate e Home Assistant sob conexões móveis (4G/5G).
- [ ] **Documentação & Runbook Operacional:**
  - Guia rápido de operação, logs (`journalctl -u dl-conn -f`) e rotação de chaves.

## Onde isso vive no código
- `flake.nix` (`nixosModules.default`)
- `/home/lluz/nixos-config/flake.nix`
- `/home/lluz/nixos-config/hosts/n100/default.nix`
- `docs/okf/concepts/` (Atualização da documentação de arquitetura)

## Critérios de Aceite (Definition of Done)
1. `nixos-rebuild switch` aplica o serviço no host `n100` sem falhas.
2. `systemctl status dl-conn` mostra o daemon ativo, conectado aos relays e com túnel pronto.
3. Acesso à página do GitHub Pages a partir de um smartphone externo lista os serviços e abre o Home Assistant / Frigate com sucesso.
