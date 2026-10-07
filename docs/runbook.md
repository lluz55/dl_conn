# Runbook Operacional — dl_conn

## Visão Geral

O daemon `dl_conn` expõe serviços locais (Frigate, Zigbee2MQTT, Agent of Empires)
através de um túnel efêmero da Cloudflare, com sinalização via Nostr (NIP-44)
e controle de acesso Zero-Trust.

## Arquitetura

```
[Cliente Web] → [Cloudflare Tunnel] → [dl_conn:9099]
     ↑                                ↓
   Nostr DM (NIP-44)          [Reverse Proxy] → [Frigate:5000]
     ↓                            [Zigbee2MQTT:8080]
[Daemon no host]              [Agent of Empires:25809]
```

## Serviços Gerenciados

| Serviço     | Porta local    | Prefixo       |
|-------------|----------------|---------------|
| Frigate      | 10.0.66.1:5000 | `/frigate`   |
| Zigbee2MQTT  | 10.1.1.10:8080 | `/zigbee2mqtt`|
| Agent of Empires | 127.0.0.1:25809 | `/aoe`   |

## Logs

```bash
journalctl -u dl-conn -f --since "5 min ago"
```

Endereços de cliente entram **anonimizados** (IPv4 truncado no prefixo de rede,
`10.0.66.*`; IPv6 nos primeiros 48 bits, `2001:db8:1234:*`), porque este log
costuma ser exportado para um agregador. Para nenhum endereço, use
`auth.logIPs: false` — o log passa a gravar `[redacted]`.

Linhas úteis no dia a dia:

| Mensagem                              | Significado                                                                  |
|---------------------------------------|------------------------------------------------------------------------------|
| `auth throttled: …`                   | Um endereço bateu no teto de `/auth`. Persistente num endereço = cliente ou bot. |
| `telemetry throttled: session_prefix=…` | Uma sessão.pollou a telemetria rápido demais.                                |
| `auth failed: … reason=token expired` | Link de serviço compartilhado que sobreviveu ao TTL do token — rotina, não ataque. |
| `session denied: … reason=ip mismatch` | Sessão reapresentada de outro endereço (cookie copiado, ou Wi-Fi/cellular trocando de IP). |

### Autenticação HTTP sobstances

Uma prova de step-up (`/api/auth/stepup`) vale 5 minutos e morre com o restart
do daemon — o segredo que a assina é sorteado por processo. Se a telemetria
começar a responder `401 {"error":"step-up required"}` depois de um restart, é o
comportamento esperado: a SPA cunha uma prova nova assim que vê o `401`, e a
primeira tentativa seguinte já passa. Se o `401` persistir, o problema é sessão —
não step-up.

Ao depurar um resgate de token, prefira a forma nova:

```bash
curl -sS -X POST https://<tunel>/auth \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'token=…&redirect=/frigate/' -i      # 200 + {"redirect": …} + cookie
```

`GET /auth?token=…` ainda responde, e traz `Sunset` e `Warning: 299` — se um
cliente próprio continuar usando a forma antiga depois dessa data, é ele que
precisa migrar para `POST` ou `X-Dl-Conn-Token`.

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
- WebSocket do Agent of Empires: `wss://[tunnel]/aoe/api/...` (o caminho
  exato é montado em runtime pelo dashboard; o proxy atribui a requisição ao
  serviço pelo cookie `dl_conn_svc`).

### 403 do Agent of Empires através do túnel
- Sintoma: a página do `/aoe/` carrega, mas toda chamada de API e o upgrade de
  WebSocket respondem 403; o painel fica vazio.
- Causa: o `aoe serve` tem um guard de DNS-rebinding que aceita apenas
  loopback, IP literal roteável e o próprio `--host`. O hostname efêmero
  `*.trycloudflare.com` é um nome, então é recusado.
- Correção: `originHost: "127.0.0.1:25809"` na entrada do serviço. Confirme
  com `curl -H 'Host: 127.0.0.1:25809' http://127.0.0.1:25809/api/...`
  (200) contra o hostname do túnel (403).
- Não troque por `--allowed-host` no lado do `aoe`: a URL do túnel muda a cada
  reinício, e a flag exigiria ressincronizar e reiniciar o serviço por rotação.

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
          id = "frigate";
          name = "Frigate";
          prefix = "/frigate";
          target = "http://10.0.66.1:5000";
        }
        {
          id = "aoe";
          name = "Agent of Empires";
          prefix = "/aoe";
          target = "http://127.0.0.1:25809";
          websocket = true;
          # Obrigatório: o guard de DNS-rebinding do `aoe serve` responde 403
          # ao hostname efêmero do túnel sem esta linha.
          originHost = "127.0.0.1:25809";
        }
      ];
    };

    # Opção B: Apontando para arquivo YAML externo (se preferir):
    # configFile = "/etc/dl-conn/config.yaml";
  };
}
```

### 3. Autorizar npubs em runtime (`dl_conn npubs add`)

Com a Opção A (`settings`) o YAML é gerado no `/nix/store`, que é somente
leitura — `dl_conn npubs add` falha em voz alta com uma dica apontando pra
isso. Autorizar um novo dispositivo exige então editar `authorizedNpubs` no
Nix e rodar `nixos-rebuild switch`, o que reinicia o serviço e derruba o
túnel Cloudflare efêmero (e a URL `trycloudflare.com` já distribuída).

Para autorizar sem restart, use `configFile` apontando para um caminho
gravável dentro do `StateDirectory` do serviço (`/var/lib/dl-conn`, já tem
`ReadWritePaths` configurado):

```nix
services.dl-conn = {
  enable = true;
  secretFile = "/run/secrets/nostr/nsec";
  configFile = "/var/lib/dl-conn/config.yaml";
};
```

O módulo **não** popula esse arquivo sozinho — na primeira vez, instale um
YAML inicial manualmente (dono/grupo do `DynamicUser`, resolvido via
`nss-systemd` depois que o serviço já rodou pelo menos uma vez):

```bash
sudo install -o dl-conn -g dl-conn -m 0640 \
  meu-config-inicial.yaml /var/lib/dl-conn/config.yaml
sudo systemctl restart dl-conn
```

Daí em diante:

```bash
sudo dl_conn npubs add npub1... --config /var/lib/dl-conn/config.yaml
```

Valida e normaliza o npub (bech32 ou hex), edita o YAML in-place preservando
comentários, escreve atomicamente (temp → fsync → rename, só depois de
revalidar o resultado) e envia `SIGHUP` ao processo do daemon — a allowlist
recarrega sem derrubar o túnel. É idempotente: rodar de novo com o mesmo
npub não duplica nem reescreve o arquivo.

### 4. Adicionar serviços em runtime sem root ou reinício (`services.d` / drop-ins)

O `dl_conn` suporta carregamento modular de serviços através de um diretório
drop-in (`services.d`), permitindo cadastrar novos serviços locais (com WebSocket,
`originHost`, `stripPrefix`, etc.) **sem precisar de root** e **sem reiniciar o daemon**
(mantendo intacta a URL pública do túnel e as sessões Zero-Trust).

#### Configuração do diretório no NixOS ou YAML:

No `configuration.nix`:
```nix
services.dl-conn = {
  enable = true;
  # Aponta para diretório com permissão de escrita para o seu usuário:
  servicesDir = "/etc/dl-conn/services.d"; # ou pasta do usuário
};
```

Ou no `config.yaml`:
```yaml
servicesDir: "/home/lluz/.config/dl-conn/services.d"
```
*(Se omitido, o daemon procura automaticamente uma pasta `services.d` junto ao `config.yaml`).*

#### Inserindo um serviço (como usuário comum):

Basta criar um arquivo `.yaml` no diretório drop-in, por exemplo `grafana.yaml`:

```yaml
id: "grafana"
name: "Grafana"
icon: "dashboard"
prefix: "/grafana"
target: "http://127.0.0.1:3000"
websocket: true
```

Formatos aceitos em cada arquivo drop-in:
1. Objeto de serviço único (exemplo acima).
2. Lista de serviços: `services: [ ... ]`.
3. Sequência direta YAML: `- id: ...`.

#### Recarregamento:
- **Detecção automática**: O daemon monitora alterações na pasta e recarrega os
  serviços, atualiza o proxy reverso, o monitor de saúde e a descoberta Nostr
  automaticamente em segundos — dispensando comandos ou sinais de processo.
- **Sinal manual**: Opcionalmente, envie `SIGHUP` para recarga imediata:
  ```bash
  systemctl reload dl-conn # ou kill -HUP <pid>
  ```


