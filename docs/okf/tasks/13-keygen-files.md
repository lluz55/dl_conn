---
type: task
phase: 13
status: done
title: "Fase 13 — keygen files: gerar npub e nsec em arquivos separados"
description: "Subcomando `dl_conn keygen files` gera um par de chaves Nostr e grava cada chave (npub e nsec) em seu próprio arquivo, contendo o valor da chave, o tipo e um timestamp UTC."
timestamp: 2026-08-26T19:30:00Z
---

# Fase 13 — `keygen files`: npub e nsec em arquivos separados

## Objetivo

Permitir que o operador gere um par de chaves Nostr e grave cada chave em seu
respectivo arquivo — `npub` (chave pública) e `nsec` (chave privada) — cada
com **tipo de chave**, **valor** e **timestamp UTC** embutidos. Útil para
provisionamento declarativo via NixOS/SOPS, onde cada arquivo é injetado
separadamente (ex.: `nsecFile` aponta para o arquivo de nsec, e o npub é
registrado na allowlist via `npubs add`).

## Decisões desta fase

1. **Subcomando `keygen files`, não flags no `keygen` raiz.** Mantém a superfície
   do `keygen` existente intacta (flags `--json`, `--qr`, `--nsec`, etc.) e segue
   o padrão de subcomando já estabelecido por `npubs add`.
2. **Formato de arquivo: YAML por padrão, JSON opcional** (`--format json`).
   YAML é consistente com `config.yaml`; JSON facilita parsing em pipelines CI/Nix.
3. **Permissões de arquivo:** `nsec` → `0600` (apenas owner lê/escreve — chave
   privada, nunca em texto claro para outros processos); `npub` → `0644` (chave
   pública, pode ser lida por qualquer um).
4. **`--from-key` suportado:** permite derivar o par a partir de um nsec/hex
   existente em vez de gerar aleatoriamente — consistente com `keygen --from-key`.
5. **`--dir` vs `--npub-file`/`--nsec-file`:** `--dir` (default `.`) controla
   onde os arquivos são criados; flags `--npub-file`/`--nsec-file` sobrescrevem
   caminas explicitamente. O diretório é criado via `MkdirAll` se não existir.

## Estrutura do arquivo

**YAML (`npub.yaml` / `nsec.yaml`):**
```yaml
type: npub
value: npub1q...
timestamp: "2026-08-26T19:30:00Z"
```

**JSON (`npub.json` / `nsec.json`):**
```json
{
  "type": "npub",
  "value": "npub1q...",
  "timestamp": "2026-08-26T19:30:00Z"
}
```

## Sub-tarefas

- [x] **`cmd/dl_conn/keygen_files.go`** — subcomando `keygen files` com flags
  `--from-key`, `--npub-file`, `--nsec-file`, `--dir`, `--format`.
  Função `writeKeyFile` serializa a entrada (`type`, `value`, `timestamp`) em
  YAML ou JSON e grava com permissões corretas.
- [x] **`cmd/dl_conn/keygen.go`** — registra o subcomando via
  `cmd.AddCommand(newKeygenFilesCmd())`.
- [x] **`cmd/dl_conn/keygen_files_test.go`** — testes cobrindo: geração
  default (YAML), formato JSON, caminas explícitas, derivação de `--from-key`,
  formato inválido (erro), permissões de arquivo (0600 nsec / 0644 npub),
  presença de timestamp e type em cada arquivo, estrutura de flags, execução
  via cobra, e registro como subcomando de `keygen`.
- [x] **`docs/runbook.md`** — documenta o comando `keygen files` na seção de
  rotação de chave.
- [x] **`docs/okf/tasks/13-keygen-files.md`** — este arquivo.

## Onde isso vive no código

- `cmd/dl_conn/keygen_files.go` (novo)
- `cmd/dl_conn/keygen_files_test.go` (novo)
- `cmd/dl_conn/keygen.go` (registro do subcomando)

## Definition of Done

1. `dl_conn keygen files --dir ./keys` cria `npub.yaml` e `nsec.yaml` com
   timestamp + type em cada arquivo.
2. O arquivo `nsec.*` tem permissão `0600`; `npub.*` tem `0644`.
3. `--format json` produz JSON válido parseável.
4. `--from-key nsec1...` deriva o par corretamente.
5. Caminas não-existentes são criadas via `MkdirAll`.
6. `go test ./cmd/dl_conn/ -run TestRunKeygenFiles -v` verde.
7. `go vet ./cmd/dl_conn/` limpo.

## Relacionado

- [[09-keygen-qr-login]] (chave gerada visualmente via QR)
- [[security](../concepts/security.md)] (gestão de chaves, permissões)
- [[protocol](../concepts/protocol.md)]
