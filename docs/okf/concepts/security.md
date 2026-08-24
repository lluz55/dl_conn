---
type: security
---

# Segurança: chaves, cifra e modelo de confiança

## Gestão de chaves (a decisão mais crítica)

A chave secreta Nostr **é** a identidade **e** a chave de cifra. Vazou =
comprometeu tudo.

| Plataforma | Estratégia |
|------------|------------|
| Android | Android Keystore via `flutter_secure_storage` |
| Linux | Keyring do SO (libsecret) via `flutter_secure_storage` |
| Web | App **nunca** guarda a chave: NIP-07 (extensão) ou NIP-46 (assinador remoto/bunker) |

A chave do SQLCipher deriva de segredo no storage seguro — nunca em texto
plano no disco. NIP-46 é recomendado como opção mesmo em desktop/mobile.

## Cifra e integridade

- Todo payload sincronizado: NIP-44 v2 (ChaCha20 + HMAC), auto-cifra.
- Assinatura Schnorr (secp256k1) verificada em todo evento recebido.
- Banco local cifrado em repouso (SQLCipher).

## Modelo de confiança

Relays não são confiáveis: não veem conteúdo (cifrado), não podem forjar
eventos (assinatura), no máximo omitem/atrasam. Mitigar com múltiplos
relays; preferir relays autenticados (NIP-42) para reduzir exposição de
metadados.

## Onde isso vive no código

`app/lib/crypto/` (chaves, NIP-44, storage seguro por plataforma). Checklist
completo em [SPEC.md §10.5](/SPEC.md#105-checklist-de-segurança).

Relacionado: [sync.md](sync.md), [environment.md](environment.md)
(reprodutibilidade de build como parte da cadeia de suprimentos).
