---
type: architecture-decision
title: Host Telemetry
---

# Host Telemetry

Collect host health (CPU temp/load/freq, RAM, disk, uptime, GPU, battery) on the Linux daemon via `/sys` and `/proc` (and `nvidia-smi` optionally). Persist locally in SQLite (without SQLCipher) with retention; expose to the SPA via authenticated `GET /api/host/telemetry` (same-origin, session cookie) and optionally via the Nostr discovery response (`host_telemetry` field, opt-in).

## Why
Users running dl_conn locally want to diagnose "why is my service slow" without SSH. Local-only by default; Nostr exposure is opt-in (`telemetry.exposeViaNostr=false` by default) because relays see kind/created_at/size.

## What
- CPU: temp from `/sys/class/thermal/thermal_zone*/temp` + hwmon fallback, load from `/proc/loadavg`, freq from `/proc/cpuinfo` / sysfs.
- RAM: `/proc/meminfo`.
- Disk: `/proc/mounts` + statfs for ext4/btrfs/xfs.
- Uptime: `/proc/uptime`.
- GPU: `nvidia-smi` (2s timeout, fail-soft).
- Battery: `/sys/class/power_supply/BAT*/capacity`.

## How
- `internal/sensors.Collector` with 10s ticker (configurable).
- `internal/store` SQLite via `modernc.org/sqlite`, single writer, `Prune` hourly.
- `internal/telemetry.Handler` at `GET /api/host/telemetry` (requires ValidSession).
- `internal/nostr.HostTelemetry` optional field in `ResponsePayload` when `telemetry.exposeViaNostr=true`.

## Frontend rendering (web/app.js)

- Capacity is formatted client-side by formatCapacity(mb): the daemon keeps
  emitting raw total_mb / used_mb (MiB), and the SPA converts to the most
  readable binary unit - MB, GB, TB, PB, base 1024 - so the protocol stays
  byte-stable and easy to test. Do not move unit conversion into the Go API
  or the Nostr host_telemetry field; keep the daemon emitting MiB.
- `uptime_s` is collected (`/proc/uptime`) and travels in the payload, and the
  SPA renders it **in the live badge** (`tel-live` / `tel-updated`): the badge's
  text is the host's uptime as its two largest units ("3 d 17 h"), because hours
  alone made a host up 45 days read as "1080h" — neither readable nor placeable
  on a calendar. `formatUptime()` decomposes into mês / sem / d / h / min and
  never shows more than two of them.
  Liveness is **not** a word in that slot. Staleness is the `is-stale` class on
  the badge (the dot goes amber), set only by a poll result; the 1s ticker
  refreshes the tooltip ("ligado há 3 d 17 h · leitura há 4s") and never the
  text. It used to swap the text to "indisponivel" and back, and the ticker —
  which tested `lastTelemetryAt`, still set from the last *good* poll —
  resurrected the badge every second, so a single failed poll flickered between
  the two states forever. Keep uptime and liveness on separate channels: two
  meanings competing for one slot flicker.
  (Ver [log.md](../log.md), Fase 18.)
- All snap.disks get their **own row** in the Armazenamento block, not one
  averaged number: averaging hides exactly the volume that is filling up. But
  "one row per *mountpoint*" is not the same as "one row per disk": a bind
  mount or a btrfs subvolume is the same filesystem seen twice, and
  `statfs` on it already reports the whole filesystem. `ReadDisks` therefore
  keys its dedup on `fsKey()` — the filesystem ID, falling back to
  size/free when a filesystem reports no ID. Measured on the dev host, one
  ext4 volume was listed three times (as `/`, `/nix/store` and the container
  overlay) with identical numbers, which read as three disks in the panel.
- Continuous refresh: startTelemetryPolling() reveals the card immediately,
  polls /api/host/telemetry every 2s, and drives a 1s liveTicker that
  updates an "ao vivo / ha Xs" badge (ids tel-live / tel-updated). A failed
  fetch keeps the last snapshot on screen and flags the badge is-stale
  ("indisponivel") instead of leaving a frozen-looking value. The
  visibilitychange handler is registered exactly once to avoid leaking
  listeners or duplicate intervals.

### O gráfico de histórico (front)

O painel tem duas camadas sobre o mesmo snapshot: medidores ao vivo e o
gráfico de série (`#hist-*`). Três decisões o mantêm utilizável:

1. **O front pede `?points=240`**, exatamente o que `HISTORY_MAX_POINTS`
   desenha. O `downsample()` do cliente continua existindo como rede de
   segurança, mas o parse de 25 MB na main thread — os ~200 ms que travavam a
   aba a cada carga — não acontece mais.
2. **`fetchHistory()` se autolimita** em vez de ser rearmado pelo poll de 2s.
   Dois relógios: `lastAttempt` (cooldown de 30 s após **qualquer** tentativa,
   então uma falha não vira uma tempestade de uma requisição de janela
   inteira a cada 2 s) e `lastSuccess` (cadência de 5 min, para a série
   acompanhar a borda viva em vez de congelar no carregamento da página). O
   botão de janela passa `force`, porque um intervalo novo invalida a resposta
   anterior por definição.
3. **Falhar não apaga o desenho.** Uma carga que dá erro mantém a série na
   tela e registra o motivo em `historyState.error`, que vira a linha de status.
   E os quatro estados vazios são distintos — carregando, erro do daemon, host
   sem a métrica, janela sem amostras — porque "sem amostras" para uma GPU que
   o host nunca reportou lia como gráfico quebrado. `missingMetricReason()`
   consulta o último snapshot ao vivo para essa distinção; no caso da GPU ele
   diz que a coleta usa `nvidia-smi`, que é a razão real em qualquer host sem
   NVIDIA.
4. **Uma resposta que não é um array é um daemon antigo, e se diz isso.**
   Um build anterior à consulta de intervalo ignora `?from=` e responde com o
   objeto do snapshot. Nenhuma versão do front conserta isso, então a mensagem
   nomeia o fato de deployment ("o daemon em execução é anterior ao
   histórico…") em vez de virar um genérico "histórico indisponível" — a
   diferença entre o operador reinstalar e o operador caçar bug no front.

### O eixo do tempo: por que os botões de janela pareciam mortos

Os três botões (`1h` / `24h` / `7d`) carregavam a janela certa desde
`d90f5b1`, e mesmo assim **trocar a janela não mudava nada na tela**. A causa
não era o filtro: era o desenho não carregar tempo nenhum.

O x era **posicional** — `i * step`, o índice do array escalado de 0 a 100 — e o
timestamp de cada amostra era lido em `renderHistory` e **descartado** (só
viajava por `downsample`, nunca virando coordenada). Três consequências, todas
medidas contra um store real:

- **24h e 7d devolvem 240 pontos cada.** Com x posicional as duas janelas eram
  desenhadas pixel a pixel idênticas: a linha mudava de forma só se o dado
  mudasse, e num host tranquilo o dado não muda. O botão marcava como
  selecionado e a tela ficava igual.
- **Uma janela parcial era esticada pela largura toda.** Com o daemon no ar há
  2 dias, a janela de 7d devolvia 69 pontos cobrindo 28,3% do intervalo,
  desenhados de ponta a ponta e rotulados "janela de 7d".
- **Falhas sumiam.** Um buraco de 90 min no meio de uma janela de 24h ocupa
  6,25% do tempo da janela e era desenhado com **um** slot (0,42% da largura):
  uma falha de hora e meia virava um entalhe quase invisível.

A correção é `historyX(fromUnix, toUnix, count)`: x sai do timestamp contra a
janela que o daemon serviu, e essa janela passa a fazer parte da identidade da
série (`historyState.fromUnix` / `toUnix`), gravada junto com `samples` e
descartada junto com a resposta de outra janela. O `fill` ancora no primeiro e
último x desenhados, não em 0 e 100.

**Tempo no eixo é o que torna a janela legível**, não um enfeite: o eixo
(`#hist-axis`, e `#avail-axis` sobre as faixas) é o que faz `1h` e `7d` de um
host estável deixarem de ser a mesma linha reta. Três rótulos (início, meio,
fim) em vez de um por ponto — um eixo denso o bastante para um tick por ponto
gasta mais largura do que o gráfico tem num celular. `historyAxisLabel()` escolhe
a precisão pelo-span: `HH:MM` até 6h, `DD/MM HH:MM` até 48h, `DD/MM` acima
disso (a hora se repete sete vezes numa semana e vira ruído).

Quando a série cobre bem menos que a janela pedida, a linha de status acrescenta
"· últimos 47 h" — a borda esquerda da linha parando antes do eixo só é honesta
se o texto concordar com ela.

**A faixa de disponibilidade já era time-linear** (`availabilityStrip` mapeia
`((ts - from) / span) * slots`), então ela não tinha o bug do gráfico — mas
tinha o mesmo buraco de leitura: são `AVAILABILITY_SLOTS` células em qualquer
janela, então num host que esteve de pé o tempo todo `1h` e `7d` são a mesma
fileira de verde. O eixo compartilhado acima das faixas resolve isso.

### A tabela de métricas do gráfico (unidade por métrica)

`HISTORY_METRICS` deixou de ser uma lista de chaves e virou uma tabela de
descritores: chave, rótulo, **unidade**, **domínio do eixo**, limiar de alerta
e o extrator da série. Isso existe porque a série deixou de ser sempre
percentual: **"60 °C" e "63 %" são grandezas diferentes**, e uma temperatura
desenhada no domínio 0..100 % é um número errado, não só um rótulo errado.
Com a tabela, o eixo, o sufixo de cada número, a linha de alerta e a
legenda da unidade saem do mesmo lugar, e o teste web avalia a tabela de
produção (extraída do fonte) em vez de manter uma cópia que derivaria dela.

- `temp` (aba "Temp.") tem unidade `°C`, domínio 0..100 °C e alerta em
  80 °C. O sensor da CPU vence porque é o que todo host x86/ARM expõe; a GPU
  é o fallback, e a legenda diz qual das duas está sendo lida. As duas nunca
  são misturadas numa série só: uma linha que trocasse de fonte no meio
  seria uma mentira sobre o host.
- `gpu` continua sendo **utilização**, que é a grandeza da barra do medidor.
  A temperatura tem sua própria métrica em vez de dividirem um eixo.
- **"Carga" saiu do seletor porque duplicava "CPU".** As duas leriam
  `(load1 / num_cpu) × 100` do mesmo campo do mesmo snapshot — não duas
  grandezas parecidas, a mesma série ponto a ponto. O que só a duplicata
  mostrava eram as médias de 5 e 15 min; isso é sinal real (separa pico de
  saturação), mas pertence a uma métrica que se sustente, não a uma segunda
  leitura do mesmo instante. "CPU" ficou com o nome e com a série de 1 min.
  O renderizador multi-série (`drawSecondarySeries`, a legenda e as duas
  polilinhas soft) **permanece**: ele é dirigido por `metric.series`, não por
  esta métrica, e a próxima métrica multi-curva não precisa de código novo.
- `historyMetric(key)` devolve o descritor e cai no primeiro quando a chave é
  desconhecida, então um `data-metric` obsoleto no markup não quebra o painel.

## Consulta de intervalo (histórico)

`telemetry_samples` já era criada com `CREATE INDEX telemetry_samples_ts ON
telemetry_samples(ts)`, mas só existia `Latest()` — não havia como ler um
intervalo, e por isso as sparklines do frontend eram um ring buffer client-side
que **zerava a cada reload**. Agora:

- `internal/store`: `Store.Range(from, to time.Time) ([]sensors.Snapshot, error)`
  — varredura indexada, inclusiva nos dois limites, ordenada por `ts ASC`.
  Retorna slice **não-nil** e vazio quando não há linhas (JSON `[]`, não
  `null`); `from` posterior a `to` também é vazio, não erro.
- `internal/telemetry`: `WithStore(*store.Store)` (opt-in, espelha `WithStepUp`),
  mais `?from=`/`?to=` em **Unix seconds**. Sem os dois params o comportamento
  é byte-a-byte o de antes: um único snapshot. Com qualquer um deles, a
  resposta é um **array** ordenado por `ts`. Valor presente e não parseável →
  `400` com corpo JSON; não cai silenciosamente para "latest".
- `cmd/dl_conn/main.go` chama `WithStore(telStore)`. Sem essa linha o handler
  responde `501` a um pedido de intervalo — a telemetria é opt-in, então o
  store pode ser legitimamente `nil`.
- Bounds parciais: falta `from` → últimas 1h (`defaultHistoryWindow`); falta
  `to` → agora. É uma escolha, não uma dedução: o default de 1h mantém um
  pedido parcial limitado em vez de despejar a retenção inteira.
- O pedido de intervalo passa pelo **rate limiter existente** (1/s, burst 5,
  compartilhado com o poll de 2s). Mais seguro que uma superfície de banco
  nova e desprotegida, mas significa que a SPA deve pedir poucas janelas por
  carga de página.

### A resposta é sempre limitada (`Store.RangeBucketed`)

`Range()` é a primitiva crua e continua existindo, mas **quem serve gráfico
usa `RangeBucketed(from, to, maxPoints)`**: a janela é cortada em no máximo
`maxPoints` buckets de tempo de largura igual e devolve a amostra **mais nova**
de cada bucket. O motivo é medido, não teórico — a janela de 7 dias que a SPA
abre por padrão, com o intervalo padrão de 10s, guarda ~60k amostras:

| | antes | depois |
|---|---|---|
| payload de `?from=&to=` (7d) | **25,3 MB** (60 480 amostras) | **0,10 MB** com `?points=240` |
| payload sem `?points=` (cliente antigo) | 25,3 MB | **0,30 MB** (teto de 720) |
| tempo da requisição | 1,06 s | 118 ms |
| `Insert` concorrente (o writer do coletor) | **820 ms** de espera | 98 ms |

O detalhe que faz a consulta ser barata não é o `MAX(ts)` e sim o fato de só
decodificar/marshalar `maxPoints` linhas: o store é `SetMaxOpenConns(1)`, então
uma leitura longa congela os `Insert` — que são justamente o que alimenta o
gráfico. `?points=N` é opcional e fica entre 1 e `maxRangePoints` (720);
acima do teto é **limitado, não recusado** (cliente que não conhece o teto não
cometeu erro que valha um pedido falhado); `?points=` não inteiro é `400`, como
os outros params. `?points=` sozinho não torna o pedido um intervalo — um teto
sem janela não tem o que limitar.

O bucket é um divisor da janela em segundos Unix e o `GROUP BY` é
`(ts - from) / bucket`, então um bucket é exatamente um intervalo alinhado e
nenhuma amostra é contada duas vezes. A divisão é sobre os **offsets inteiros**
da janela (`span+1`, de 0 a `span`), não sobre `span`: dividir `span` devolveria
`maxPoints+1` grupos exatamente quando a janela divide por `maxPoints`, e o teto
tem de ser um teto. Dentro do bucket vence a linha mais nova porque o SQLite
devolve uma coluna "nua" a partir da linha do extremum de um único
`min()`/`max()` agregado — um grupo é um snapshot coerente, não uma mistura de
colunas de linhas diferentes.

**Decisão de carga:** `Snapshot.NumCPU` (`num_cpu`, `runtime.NumCPU()`) é
emitido porque *load average* só se interpreta relativo ao número de núcleos —
0.42 é ocioso num host de 4 e carregado num de 64. Sem ele o frontend não tem
como mostrar **percentual** de CPU, que é a única forma de o número significar
algo num painel. Sem `num_cpu` o cliente mostra a carga bruta e nenhuma barra,
em vez de inventar um percentual.

## Security / Platform
- Endpoint bound to same origin, no CORS, session-IP binding.
- `/sys`/`/proc` readable under NixOS `DynamicUser` + `ProtectSystem=strict`.
- VMs may report 0 temp → mark unavailable.
