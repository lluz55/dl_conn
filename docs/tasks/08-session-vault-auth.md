---
type: task
phase: 8
status: pending
title: "Fase 8 — Cofre Cifrado Local de Identidade & Sessão via PIN / Biometria (WebAuthn)"
description: "Armazenamento seguro do npub/nsec no navegador com cofre criptográfico Web Crypto API (PBKDF2 + AES-256-GCM), autenticação por PIN de sessão e desbloqueio biométrico via WebAuthn."
timestamp: 2026-08-23T16:00:00Z
---

# Fase 8 — Cofre Cifrado Local de Identidade & Sessão via PIN / Biometria (WebAuthn)

## Objetivo
Implementar um mecanismo robusto de armazenamento local criptografado para o cliente web (`web/`), permitindo que usuários que não utilizem extensões de navegador (NIP-07) possam salvar sua identidade Nostr (`npub`/`nsec` e configurações de relays) com segurança e conveniência. O acesso e o início de cada sessão devem exigir autenticação local por **PIN/Senha** e/ou **Biometria do Dispositivo via WebAuthn (TouchID, FaceID, Windows Hello, Android Biometric)**, impedindo o armazenamento de chaves privadas em texto plano no `localStorage`.

---

## Arquitetura Criptográfica & Web Crypto API

```mermaid
flowchart TD
    subgraph Registro / Configuração Inicial
        UserIn[Usuário insere nsec + Define PIN de 4-8 dígitos] --> KDF[PBKDF2 SHA-256 / 300.000 iterações + Salt 16B]
        KDF --> DerivedKey[Chave Simétrica AES-256]
        UserIn --> PlainData[Payload JSON: { npub, nsec, skHex, relays, prefs }]
        PlainData --> Encrypt[AES-256-GCM + IV 12B]
        DerivedKey --> Encrypt
        Encrypt --> VaultData[Cofre Cifrado: { salt, iv, ciphertext, authTag, publicHint }]
        
        OptBio{Ativar Biometria?} -->|Sim| WebAuthnReg[navigator.credentials.create Platform Authenticator]
        WebAuthnReg --> WrapBio[Cifra da chave mestre associada à credencial WebAuthn]
        WrapBio --> VaultData
        OptBio -->|Não| SaveLS[Gravar dl_conn_vault no localStorage]
        VaultData --> SaveLS
    end

    subgraph Acesso / Início de Sessão
        OpenApp[Abertura da SPA / Fim do Timeout] --> DetectVault{dl_conn_vault existe?}
        DetectVault -->|Sim| PromptUnlock[Exibir Tela de Desbloqueio de Sessão]
        
        PromptUnlock --> ChoiceUnlock{Método Escolhido}
        
        ChoiceUnlock -->|Biometria| BioAuth[navigator.credentials.get User Verification]
        BioAuth -->|Sucesso| UnwrapKey[Desembrulha Chave Mestre]
        
        ChoiceUnlock -->|PIN| PinInput[Usuário digita PIN]
        PinInput --> DerivPin[PBKDF2 com Salt salvo]
        DerivPin --> DecryptGCM[AES-256-GCM Decrypt]
        
        UnwrapKey --> DecryptGCM
        DecryptGCM -->|AuthTag Válida| MemorySession[Carrega sk e npub estritamente na MEMÓRIA RAM da Sessão]
        DecryptGCM -->|AuthTag Inválida| ErrorPin[Erro: PIN incorreto / Incrementa contador de falhas]
        
        MemorySession --> StartApp[Inicia Conexão Nostr e Descoberta de Serviços]
        MemorySession --> InactivityTimer[Timer de Inatividade: 15 min -> Limpa Memória & Bloqueia]
    end
```

---

## Sub-tarefas

- [ ] **Módulo Criptográfico de Cofre (`web/js/crypto_vault.js`):**
  - Implementação isolada baseada exclusivamente na **Web Crypto API nativa do navegador (`window.crypto.subtle`)** sem dependências externas pesadas.
  - **Função de Derivação de Chaves (KDF):**
    - Algoritmo: `PBKDF2` com hash `SHA-256`.
    - Parâmetros: `iterations: 300000`, salt criptograficamente seguro gerado via `crypto.getRandomValues(new Uint8Array(16))`.
  - **Cifra Autenticada:**
    - Algoritmo: `AES-GCM` com tamanho de chave de 256 bits.
    - Vetor de Inicialização (IV): 12 bytes gerados aleatoriamente a cada operação de escrita.
    - Autenticação e integridade garantidas pela *Authentication Tag* do GCM (prevenindo manipulação do cofre).
  - Serialização e desserialização seguras do envelope do cofre em formato Base64 para persistência no `localStorage` (chave `dl_conn_vault`).

- [ ] **Módulo de Autenticação Biométrica WebAuthn (`web/js/webauthn_manager.js`):**
  - Detecção de suporte do navegador e hardware a autenticadores de plataforma (`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`).
  - **Registro de Credencial Local (`navigator.credentials.create`):**
    - `authenticatorAttachment: "platform"` (TouchID, FaceID, leitor biométrico Android, Windows Hello).
    - `userVerification: "required"`.
    - `residentKey: "preferred"`.
  - **Desbloqueio com Biometria (`navigator.credentials.get`):**
    - Solicitação de verificação biométrica ao usuário.
    - Uso da extensão PRF (*Pseudo-Random Function*) ou chave de envelope para liberar a chave mestre de decifragem do cofre local sem necessidade de re-digitar o PIN.
  - Tratamento de cancelamento do usuário, fallback transparente para o PIN e detecção de navegadores não suportados.

- [ ] **Controlador de Ciclo de Vida de Sessão (`web/js/session_manager.js`):**
  - **Isolamento de Memória:** Garantir que a chave privada decifrada (`sk` / `nsec`) resida apenas em escopo fechado (variável privada em instância JS) e **nunca** seja gravada em `sessionStorage`, `localStorage` ou variáveis globais `window`.
  - **Bloqueio por Inatividade (Auto-Lock):**
    - Timer configurável (padrão: 15 minutos sem interação do usuário).
    - Escuta de eventos (`visibilitychange`, minimização da aba, `pointerdown`, `keydown`) para resetar o timer ou bloquear preventivamente.
    - Ao disparar o bloqueio: sanitizar a memória (`zeroize` / `null` referências da chave), fechar conexões ativas e exibir a tela de desbloqueio.
  - **Proteção contra Força-Bruta:**
    - Contador de tentativas incorretas com atraso exponencial (ex: 1s após 3 falhas, 5s após 5 falhas).
    - Opção de bloqueio temporário ou wipe total após número limite de tentativas (ex: 10 tentativas).
  - **Função "Wipe / Sair e Limpar Dispositivo":**
    - Remoção atômica do `localStorage` e recarregamento da aplicação em estado limpo.

- [ ] **Interface do Usuário (UI) & Telas de Sessão (`web/index.html`, `web/style.css`, `web/app.js`):**
  - **Fluxo 1 — Primeiro Login / Criação do Cofre:**
    - Ao inserir o `nsec` manualmente, exibir opção: *"Salvar identidade neste dispositivo com segurança"*.
    - Modal de definição de PIN (com teclado numérico acessível em mobile, input mascarado e confirmação).
    - Prompt opcional: *"Deseja habilitar desbloqueio biométrico (Impressão Digital / Face)?"*.
  - **Fluxo 2 — Desbloqueio de Sessão (Retorno ao App):**
    - Exibição limpa da identidade pública cadastrada (*"Identidade salva: npub1abc...xyz"*).
    - Botão de destaque: *"Desbloquear com Biometria"* (com ícone de digital/face se suportado e habilitado).
    - Campo para inserção do PIN com botão de desbloqueio.
    - Link de emergência: *"Esqueci o PIN / Usar outra conta"* (aciona o modal de confirmação de wipe).
  - **Fluxo 3 — Estado Conectado & Ações Rápidas:**
    - Botão discreto *"🔒 Bloquear Sessão"* no header para bloqueio manual instantâneo.
    - Indicador visual do tempo restante de sessão ou status de cofre seguro.

- [ ] **Integração com `NostrAuth` (`web/js/nostr_auth.js`):**
  - Refatorar `NostrAuth` para delegar o ciclo de vida da identidade ao `SessionManager` e `CryptoVault`.
  - Manter compatibilidade com login NIP-07 (extensão Alby/nos2x) para quem preferir extensão externa.

- [ ] **Testes Automatizados & Segurança:**
  - Teste de round-trip criptográfico (cifra com PIN -> decifra com mesmo PIN -> payload idêntico).
  - Teste de integridade (falha garantida na decifragem ao fornecer PIN incorreto ou payload corrompido).
  - Teste de auto-lock por expiração de tempo.
  - Teste de conformidade: inspeção do `localStorage` provando ausência de `nsec` ou `sk` em texto plano.

---

## Onde isso vive no código
- `web/js/crypto_vault.js` (Módulo Web Crypto API: PBKDF2 + AES-GCM)
- `web/js/webauthn_manager.js` (Módulo WebAuthn / Biometria de plataforma)
- `web/js/session_manager.js` (Gerenciador de sessão em memória, timeout e auto-lock)
- `web/js/nostr_auth.js` (Integração da camada de identidade com o cofre)
- `web/app.js` (Fluxos de UI, transições de tela e manipulação de eventos)
- `web/index.html` (Modais de PIN, Biometria e Tela de Desbloqueio)
- `web/style.css` (Estilos responsivos, badges coloridos e animações)

---

## Critérios de Aceite (Definition of Done)
1. **Zero Plaintext:** A chave privada `nsec` / `sk` jamais é persistida em texto plano no `localStorage` ou `sessionStorage`.
2. **Cofre Autenticado:** O cofre local é criptografado com AES-256-GCM derivado via PBKDF2 (300.000 iterações) a partir do PIN do usuário.
3. **Desbloqueio por PIN:** Ao recarregar a SPA, a identidade salva só é recuperada e ativada após a inserção bem-sucedida do PIN cadastrado.
4. **Desbloqueio Biométrico:** Em dispositivos compatíveis (TouchID no macOS/iOS, leitor biométrico no Android, Windows Hello no Windows), o usuário consegue desbloquear a sessão com biometria nativa sem digitar o PIN.
5. **Auto-Lock por Inatividade:** Após 15 minutos sem atividade (ou ao bloquear manualmente), as chaves em memória são destruídas e a tela de bloqueio é exibida.
6. **Wipe de Emergência:** O usuário pode a qualquer momento limpar o cofre local e cadastrar uma nova chave ou alternar para login via NIP-07.
7. **Responsividade & Acessibilidade:** As telas de PIN e Biometria funcionam fluidamente em navegadores mobile (Android Chrome/Samsung Internet, Safari iOS) e desktop (Chrome/Firefox/Edge).
