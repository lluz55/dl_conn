---
type: protocol
---

# Protocolo de payload (sinalização Nostr)

## O que é

A sinalização entre o cliente web e o daemon `dl_conn` trafega como **DM NIP-44**
(ChaCha20-Poly1305 via NIP-44 v2) sobre relays Nostr. O conteúdo cifrado é um
JSON com duas formas: `RequestMessage` (pedido) e `ResponsePayload` (resposta).
A fonte de verdade é `internal/nostr/protocol.go` — este arquivo é o resumo
navegável dentro do bundle OKF.

## Mensagens

```go
// Pedido: o cliente envia uma DM cifrada com esta ação.
type RequestMessage struct {
    Action string `json:"action"` // "discover_services"
}

// Resposta: o daemon devolve a URL do túnel + token de acesso + serviços.
type ResponsePayload struct {
    Status            string        `json:"status"`             // "ok"
    TunnelURL         string        `json:"tunnel_url"`         // https://*.trycloudflare.com
    AuthToken         string        `json:"auth_token"`         // token de sessão Zero-Trust
    ExpiresInSeconds  int           `json:"expires_in_seconds"`
    Services          []ServiceInfo `json:"services"`           // id, name, icon, prefix, websocket, status
    HostTelemetry     *HostTelemetry `json:"host_telemetry,omitempty"`
}
```

Constantes e regras exatas (kinds Nostr usados, tags, modelo de auto-cifra NIP-44,
limites de tamanho) vivem em `internal/nostr/client.go` / `handler.go` /
`crypto.go` — **consulte o código antes de mudar o formato**.

## Regras de confiança

- **NIP-44 sempre:** nenhum payload em texto claro é publicado.
- **Assinatura verificada** em todo evento recebido (`CheckSignature`); o campo
  `pubkey` sozinho não prova nada.
- **Anti-replay:** eventos com mais de `maxEventAge` (5 min) são rejeitados.
- **Allowlist:** só npubs em `nostr.authorizedNpubs` recebem resposta; DM de
  remetente fora da lista é descartada em silêncio (`ParseEvent`).

## Versionamento

`ResponsePayload` usa campos `omitempty`; campos novos são adicionados no final e
permanecem retrocompatíveis. Não remova nem renomeie campos existentes sem bump no
`config`/`handler` e sem atualizar o cliente web (`web/js/nostr_auth.js`).

Relacionado: [sync.md](sync.md), [security.md](security.md) (cifra e confiança).
