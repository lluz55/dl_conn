---
type: security
---

# Segurança: chaves, cifra e modelo de confiança

## Gestão de chaves (a decisão mais crítica)

A chave privada Nostr **é** a identidade **e** a chave de cifra. Vazou =
comprometeu tudo.

| Plataforma | Estratégia |
|------------|------------|
| Web (SPA `web/`) | A chave **nunca** é gravada em `localStorage`/`sessionStorage` em texto claro: vive em memória e o único formato em repouso é o cofre **AES-256-GCM** de `web/js/crypto_vault.js`. Opções de login: NIP-07 (extensão do navegador) ou NIP-46 (assinador remoto/bunker). |
| Daemon Go (`dl_conn`) | A nsec é injetada em runtime via `--nsec` / `--nsec-file` / `nostr.nsec` / `nostr.nsecFile` (SOPS) — **nunca** hardcoded nem versionada. |

A chave do daemon deriva de segredo injetado (SOPS/`nsecFile`), nunca em texto
plano no disco. NIP-46 é recomendado também em desktop/servidor.

## Cifra e integridade

- Todo payload de sinalização: NIP-44 v2 (ChaCha20 + Poly1305), auto-cifra.
- Assinatura Schnorr (secp256k1) verificada em todo evento recebido.
- O cofre do SPA e o canal NIP-44 protegem a chave/segredo em trânsito e em
  repouso no cliente; o daemon não persiste a nsec.

## Modelo de confiança

Relays não são confiáveis: não veem conteúdo (cifrado), não podem forjar
eventos (assinatura), no máximo omitem/atrasam. Mitigar com múltiplos
relays; preferir relays autenticados (NIP-42) para reduzir exposição de
metadados.

## Allowlist de npubs do daemon (`dl_conn`)

Quem pode falar com o host é decidido por `nostr.authorizedNpubs`
(`config.yaml`). `NewClient` decodifica cada npub para hex e monta
`Client.authorized`, sempre incluindo a própria pubkey do host
(`internal/nostr/client.go`). DM de remetente fora da lista é **descartado em
silêncio** por `ParseEvent` — sem resposta e sem erro vazado, para não
confirmar a existência do host a quem sonda. O lado do cliente só percebe isso
como timeout (a SPA avisa após 30 s, ver [[10-nsec-session-start]]).

Regras que decorrem disso:

- A lista é **allowlist, nunca denylist**: um npub desconhecido não tem
  caminho de fallback.
- Assinatura Schnorr é verificada antes da checagem de autorização — o campo
  `PubKey` do evento sozinho não prova nada.
- Eventos com mais de 5 min (`maxEventAge`) são rejeitados: sem isso um relay
  poderia **repetir** um DM antigo de um remetente legítimo.
- Alterar a lista com o daemon rodando é a [[11-runtime-npub-authorization]] —
  a leitura de `Client.authorized` acontece na goroutine do `Serve`, então
  qualquer recarga precisa de lock, e a pubkey do host tem de sobreviver a ela.

## Onde isso vive no código

- Web: `web/js/crypto_vault.js` (cofre AES-256-GCM, em memória),
  `web/js/nostr_auth.js` / `web/js/nostr_client.js` (login NIP-07/46),
  `web/index.html` (CSP `script-src 'self'`; bibliotecas vendored em
  `web/vendor/`).
- Daemon Go: `internal/nostr/client.go` (allowlist, verificação de assinatura,
  janela anti-replay) e `internal/config/config.go` (`authorizedNpubs`,
  `GetNsec`).

## Bootstrap de sessão de serviços internos

Serviços com uma segunda autenticação de lançamento, como `dsh web`, podem
configurar `launchTokenFile`. O arquivo contém a URL local impressa pelo
processo. Somente depois de validar a sessão Zero-Trust do `dl_conn`, o proxy
confere que a URL pertence exatamente ao `target`, resgata o token via loopback
e devolve apenas o cookie assinado com `Path=/`, necessário para APIs absolutas
como `/api/directoryPicker/list`, e reforçado com `Secure`, `HttpOnly` e
`SameSite=Lax`. O proxy remove cookies `dsh-auth-*` antes de encaminhar a outros
serviços; somente o serviço configurado recebe o cookie de sua autoridade.
Um marcador `HttpOnly` restrito ao prefixo identifica que o cookie raiz já foi
emitido pelo proxy; assim, cookies legados restritos a `/dsh/` não impedem a
migração automática no próximo acesso. Isso reduz exposição entre backends,
mas não isola aplicações que compartilham
a mesma origem no navegador. `Lax` permite a navegação GET
iniciada no frontend de outro domínio; `Strict` suprime o cookie nessa cadeia
de redirecionamentos e causa bootstrap repetido. O token não atravessa o túnel,
não entra no histórico do navegador e nunca é registrado pelo `dl_conn`.
Falhas de leitura, validação, resgate ou cookie fecham o acesso (`502`/`503`).

Relacionado: [sync.md](sync.md), [architecture.md](architecture.md),
[environment.md](environment.md) (reprodutibilidade de build como parte da
cadeia de suprimentos).
