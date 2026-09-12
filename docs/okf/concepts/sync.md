---
type: architecture-decision
---

# Sinalização via Nostr

## Decisão

Nostr é tratado como **transporte burro e não confiável** para a **sinalização**
(descoberta + entrega da URL do túnel e do token de acesso), **não** como
mecanismo de sincronização de dados. Todo payload é assinado e cifrado; nenhum
relay é fonte de verdade. Fluxo:

- **Pedido (cliente → daemon):** DM NIP-44 com `RequestMessage{action:
  "discover_services"}` endereçada à npub autorizada do host.
- **Resposta (daemon → cliente):** DM NIP-44 com `ResponsePayload` contendo
  `tunnel_url`, `auth_token`, `expires_in_seconds`, `services` e — opcionalmente
  — `host_telemetry`. O cliente usa a URL + token para abrir a sessão Zero-Trust
  contra o serviço alvo através do túnel.

Não há *changesets*, *snapshots* nem CRDT: os serviços locais já estão prontos no
host; o papel da Nostr é apenas descobrir a porta de entrada cifrada e autorizar
o acesso.

## Por quê

- **Sem servidor de sinalização próprio:** o daemon não expõe nenhum endpoint de
  descoberta público; a URL efêmera do túnel é entregue diretamente à(s) npub(s)
  autorizada(s) via relays públicos/privados.
- **Zero-Trust:** só npubs em `nostr.authorizedNpubs` recebem a resposta; a
  assinatura de cada evento é verificada (`CheckSignature`) e eventos com mais de
  5 min (`maxEventAge`) são descartados (anti-replay). Um relay malicioso não
  consegue forjar a resposta nem ler o conteúdo (NIP-44).

## Onde isso vive no código

`internal/nostr` (`client.go` — allowlist/verificação/anti-replay;
`handler.go` — monta o `ResponsePayload`; `protocol.go` — `RequestMessage`/
`ResponsePayload`; `crypto.go` — NIP-44). O cliente web inicia o pedido em
`web/js/nostr_auth.js` / `web/js/nostr_client.js`.

Relacionado: [protocol.md](protocol.md) (payload exato), [security.md](security.md)
(cifra e modelo de confiança), [architecture.md](architecture.md).
