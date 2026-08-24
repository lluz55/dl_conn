---
type: task
phase: 9
status: done
title: "Fase 9 — QR do keygen para auto-preenchimento do nsec no frontend"
description: "O `keygen` (Go) imprime um QR scannable com o nsec no terminal; a SPA web lê o QR via câmera (BarcodeDetector + fallback jsQR) e preenche/autentica o campo nsec automaticamente."
timestamp: 2026-08-24T18:00:00Z
---

# Fase 9 — QR do keygen para auto-preenchimento do nsec no frontend

## Objetivo
Permitir que o usuário gere o par de chaves com `dl_conn keygen --qr` e transfira o
`nsec` para a SPA web sem digitação manual: aponta a câmera do celular (onde roda a
SPA) para o QR exibido no terminal do host e o nsec é lido, validado e usado no login
(nsec fallback, caminho já existente em `web/app.js` → `onLoginNsec`).

## Backend — `cmd/dl_conn/keygen.go`
- [x] Nova flag `--qr`: imprime QR half-block do `nsec` (`github.com/mdp/qrterminal/v3` → `GenerateHalfBlock`).
- [x] Aviso em stderr: "não fotografe/compartilhe — é sua chave privada".
- [x] Guarda: `--qr` + `--json` retorna erro (QR é saída humana, corromperia JSON).
- [x] Conteúdo do QR = string `nsec1…` crua (nada além da chave).
- [x] Testes: `TestRunKeygen_QR` (contém glifo de bloco + aviso), `TestRunKeygen_QRJSONConflict`.

## Frontend — `web/`
- [x] `web/js/qr_scanner.js`: `parseQrResult(text)` pura (valida prefixo `nsec1` + charset bech32) + `startScan({video,onResult,onStatus})` (getUserMedia → loop rAF; decodifica com `BarcodeDetector` nativo ou `jsQR` via esm.sh).
- [x] `web/index.html`: símbolo `i-qr` no sprite; botão **"Ler nsec via QR" direto na tela de login** (fora do `<details>` recolhido) + overlay `#qr-overlay` com `<video id="qr-video">`.
- [x] `web/style.css`: estilos do overlay/modal e do vídeo (tokens `--color-surface`, `--radius-input`, `--gap-md`).
- [x] `web/app.js`: importa `startScan`; liga botão e fechar; ao decodificar nsec válido, preenche `#nsec-input`, fecha overlay e dispara `onLoginNsec` (auto-login).
- [x] `web/tests/qr_scanner_tests.js`: cobre `parseQrResult` (aceita nsec, rejeita npub/lixo/whitespace/inválido).

## Segurança
- [x] QR expõe a chave privada só em canal visual (mesmo risco do nsec já impresso no default do keygen e do login manual). Sem novo vetor de armazenamento; SPA não persiste além do existente (`sessionStorage` no login nsec).
- [x] Sem logs do nsec; `getUserMedia` exige contexto seguro (HTTPS/localhost — OK no deploy GitHub Pages).

## Definition of Done
- `go test ./cmd/dl_conn/ -run TestRunKeygen` verde; `node web/tests/qr_scanner_tests.js` verde; `node --check` em `app.js`/`qr_scanner.js`.
