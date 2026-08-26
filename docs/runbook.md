# Runbook Operacional — dl_conn

## Visão Geral

O daemon `dl_conn` expõe serviços locais (Home Assistant, Frigate, Zigbee2MQTT)
através de um túnel efêmero da Cloudflare, com sinalização via Nostr (NIP-44)
e controle de acesso Zero-Trust.

## Arquitetura

```
[Cliente Web] → [Cloudflare Tunnel] → [dl_conn:9099]
     ↑                                ↓
   Nostr DM (NIP-44)          [Reverse Proxy] → [HASS:8123]
     ↓                            [Frigate:5000]
[Daemon no host]              [Zigbee2MQTT:8080]
```

## Serviços Gerenciados

| Serviço     | Porta local    | Prefixo       |
|-------------|----------------|---------------|
| Home Assistant | 10.0.66.1:8123 | `/hass`     |
| Frigate      | 10.0.66.1:5000 | `/frigate`   |
| Zigbee2MQTT  | 10.1.1.10:8080 | `/zigbee2mqtt`|

## Logs

```bash
journalctl -u dl-conn -f --since "5 min ago"
```

## Rotação de Chave Nostr

1. Gere um novo par de chaves Nostr via CLI:
   ```bash
   dl_conn keygen
   # ou apenas a nsec:
   dl_conn keygen --nsec
   # ou em formato JSON:
   dl_conn keygen --json
   ```
2. Para gravar cada chave em seu próprio arquivo (com timestamp e tipo):
   ```bash
   dl_conn keygen files --dir ./keys
   # ou caminas explícitas:
   dl_conn keygen files --npub-file ./pub.key --nsec-file ./priv.key
   # formato JSON:
   dl_conn keygen files --dir ./keys --format json
   # derivar de uma nsec existente:
   dl_conn keygen files --from-key nsec1... --dir ./keys
   ```
   O arquivo `nsec.*` é criado com permissão `0600`; o `npub.*` com `0644`.
2. Atualize o segredo no SOPS:
   ```bash
   sops -d /path/to/secrets/nostr/dl-conn-key.yaml
   # edit and re-encrypt
   sops -e /path/to/secrets/nostr/dl-conn-key.yaml
   ```
3. Reinicie o serviço:
   ```bash
   systemctl restart dl-conn
   ```

## Solução de Problemas

### Túnel não conecta
- Verifique se `cloudflared` está no PATH: `which cloudflared`
- Verifique logs: `journalctl -u dl-conn -n 100`
- Teste manual: `cloudflared tunnel --url http://127.0.0.1:9099 --no-autoupdate`

### Nostr não recebe respostas
- Verifique se a npub do cliente está na whitelist `authorizedNpubs`
- Verifique conectividade aos relays: `curl -v wss://relay.damus.io`

### WebSocket falha no proxy
- O proxy encaminha `Upgrade: websocket` automaticamente para serviços
  com `websocket: true` na configuração.
- Home Assistant WebSocket: `wss://[tunnel]/hass/api/websocket`

### Cookie de sessão expirado
- TTL padrão: 4h (configurável via `auth.sessionTTL`)
- Token de uso único: 120s (configurável via `auth.tokenTTL`)

## Performance

- **Latência de descoberta:** < 1.5s (Nostr → token → resposta)
- **Latência do proxy:** < 5ms overhead além do cloudflared
- **Concorrência:** testado com 50+ conexões simultâneas

## Integração via Flake (NixOS Module)

Para utilizar o `dl_conn` como serviço em outro flake (ex: `nixos-config`):

### 1. `flake.nix` do consumidor:
```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    dl_conn.url = "github:seu-usuario/dl_conn"; # ou path:/home/lluz/dev/dl_conn
  };

  outputs = { self, nixpkgs, dl_conn, ... }: {
    nixosConfigurations.n100 = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        dl_conn.nixosModules.default
        ./configuration.nix
      ];
    };
  };
}
```

### 2. Configuração no módulo NixOS (`configuration.nix` ou `hosts/n100/default.nix`):
```nix
{ config, pkgs, ... }:

{
  services.dl-conn = {
    enable = true;
    secretFile = "/run/secrets/nostr/nsec"; # ou config.sops.secrets."nostr/dl-conn-key".path

    # Opção A: Declarativo via settings no Nix
    settings = {
      nostr = {
        relays = [
          "wss://relay.damus.io"
          "wss://nos.lol"
          "wss://relay.nostr.band"
          "wss://relay.primal.net"
          "wss://nostr.mom"
        ];
        authorizedNpubs = [
          "npub1pjatm6grg542qqyvtzyyvkd7ehue28rtsjh45ss7008s38ls9zhq5tlw2p"
        ];
      };
      tunnel = {
        listenPort = 9099;
      };
      services = [
        {
          id = "hass";
          name = "Home Assistant";
          prefix = "/hass";
          target = "http://10.0.66.1:8123";
          websocket = true;
        }
        {
          id = "frigate";
          name = "Frigate";
          prefix = "/frigate";
          target = "http://10.0.66.1:5000";
        }
      ];
    };

    # Opção B: Apontando para arquivo YAML externo (se preferir):
    # configFile = "/etc/dl-conn/config.yaml";
  };
}
```

