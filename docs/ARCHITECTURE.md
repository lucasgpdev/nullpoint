# NULLPOINT — Arquitetura técnica

> Codinome do projeto: **NULLPOINT**. Identidade visual, mapas, armas e nomes são originais.

## 1. Análise do ambiente

| Item | Situação | Uso |
|---|---|---|
| Node.js 22 / npm 10 | Disponível | Servidor, build, testes |
| Google Chrome + Playwright | Disponível | Teste E2E com 2 navegadores reais |
| PostgreSQL 16 / Redis 7 | Disponível | Entram na Fase 5/6 (contas, estatísticas). A Fase 1 não persiste dados |
| Blender | Indisponível | Modelos da Fase 1 são gerados por código (ver §6) |

## 2. Visão geral

```
┌─────────── Navegador (cliente) ───────────┐        ┌──────────── Servidor Node.js ────────────┐
│ UI (HTML/CSS)  ─ menu, lobby, HUD         │        │ RoomManager ─ códigos, host, lobby       │
│ Render (Three.js/WebGL)                   │ WS     │ Match (loop 60 Hz, autoritativo)         │
│ Predição local + reconciliação ◄──────────┼────────┼─► fila de comandos por jogador           │
│ Interpolação de jogadores remotos         │Socket.IO│  simulação (mesma física do cliente)     │
│ Áudio espacial (WebAudio)                 │        │  histórico de posições (lag compensation)│
└──────────────────┬────────────────────────┘        │  validação: taxa, munição, cadência      │
                   │                                  └──────────────────┬───────────────────────┘
                   └──────────── @nullpoint/shared ──────────────────────┘
                     física, mapas, armas, protocolo, raycast (código idêntico nos dois lados)
```

**Decisão central:** a física, o mapa de colisão, as definições de armas e o cálculo de dispersão vivem em `shared/` e são executados pelo cliente (para prever) e pelo servidor (para decidir). Assim a previsão quase nunca erra, e quando erra a reconciliação corrige sem saltos visíveis.

## 3. Bibliotecas

| Biblioteca | Onde | Motivo |
|---|---|---|
| `three` | cliente | Renderização WebGL, sombras, PBR, áudio posicional |
| `socket.io` / `socket.io-client` | servidor/cliente | Salas, reconexão automática, acks (somente transporte WebSocket) |
| `vite` | cliente | Dev server e build otimizado |
| `esbuild` / `tsx` | servidor | Build e execução TypeScript |
| `vitest` | testes | Unitários e integração |
| `playwright` | testes | E2E com dois navegadores |
| `@fontsource/*` | cliente | Fontes empacotadas (sem depender de CDN) |

Fases futuras: `pg` (PostgreSQL), `ioredis` (Redis), `argon2` (senhas), `meshoptimizer`/KTX2 (compressão de assets), WebRTC (voz).

## 4. Estrutura de pastas

```
/shared/src        constants, protocol (mensagens), types, physics, collision, weapons, maps, rng, validate
/server/src        index (HTTP + Socket.IO), rooms/, matches/, players/, combat/, network/, security/
/client/src        main, game/, player/, weapons/, animations/, maps/, multiplayer/, audio/, effects/, ui/, config/
/tests             integration (2 clientes socket reais) e e2e (2 navegadores reais)
/docs              arquitetura e protocolo
/assets            pipeline futuro de GLB/texturas/sons (ver assets/README.md)
```

Monorepo com npm workspaces. `/server/src/database` e `/client/src/inventory` serão criados quando suas fases chegarem, para não deixar módulos vazios.

## 5. Comunicação cliente ↔ servidor

### Modelo
- **Servidor autoritativo** a 60 Hz; envia snapshots a 30 Hz.
- O cliente amostra entrada a 60 Hz (passo fixo `1/60 s`) e envia lotes de comandos a ~30 Hz.
- Cada comando: `seq`, botões (bitmask), `yaw`, `pitch`, `viewTime` (momento do servidor que o cliente estava vendo).
- **Predição:** o cliente aplica o próprio comando imediatamente com a física compartilhada.
- **Reconciliação:** cada snapshot traz `ackSeq`; o cliente volta ao estado do servidor e reaplica os comandos não confirmados. Erros pequenos são suavizados visualmente.
- **Interpolação:** jogadores remotos são desenhados ~100 ms no passado, entre dois snapshots.
- **Compensação de latência:** o servidor guarda 1 s de histórico de hitboxes. Ao processar um disparo, rebobina os alvos até `viewTime` (limitado a 250 ms) e faz o raycast.
- **Sincronização de relógio:** offset estimado por RTT a cada 2 s, suavizado.

### Mensagens (resumo — detalhes em `shared/src/protocol.ts`)
| Direção | Evento | Conteúdo |
|---|---|---|
| C→S | `room:create` / `room:join` / `room:rejoin` | nome, código, token de sessão |
| C→S | `room:config` / `room:start` / `room:leave` | somente host para config/start |
| C→S | `input` | lote de comandos |
| C→S | `net:ping` | timestamp (ack com hora do servidor) |
| S→C | `room:state` | jogadores, host, config, fase |
| S→C | `match:start` / `match:end` | seed, spawn, placar final |
| S→C | `snap` | tempo, ackSeq, estado de todos os jogadores |
| S→C | `ev` | disparos, acertos, abates, respawn, recarga |

### Segurança (Fase 1)
- Validação de formato e limites de todo payload; mensagens inválidas são descartadas e contadas.
- Rate limiting por evento (token bucket); excesso persistente desconecta.
- **Orçamento de comandos:** o servidor só processa tantos comandos quanto o tempo real permite → speed hack não funciona.
- Velocidade, gravidade e colisão são calculadas pelo servidor; o cliente não envia posição.
- Cadência, munição, recarga e semiautomático (precisa soltar o gatilho) validados no servidor.
- Dispersão calculada pelo servidor com semente determinística; o cliente só a prevê.
- O cliente nunca informa dano, acerto ou abate.

## 6. Modelos, animações e áudio

- Interface `ViewModel` (arma em 1ª pessoa) e `CharacterModel` (3ª pessoa) com **sockets** nomeados (`muzzle`, `ejectPort`, `magazine`, `slide`) e animações nomeadas (`draw`, `fire`, `reload`, `inspect`, `idle`).
- Fase 1: a pistola, os braços e o personagem são construídos por código (geometrias com materiais PBR) e animados por um sistema de keyframes procedural. Não são imagens estáticas.
- Quando houver arquivos `.glb` (Blender), um `GltfViewModel` implementa a mesma interface usando `AnimationMixer`; as mecânicas não mudam.
- Sons sintetizados por WebAudio (originais, sem problemas de licença), posicionados com `PannerNode` HRTF.

## 7. Cronograma por fases e critérios objetivos

| Fase | Entrega | Critério de conclusão |
|---|---|---|
| **1 — MVP multiplayer** | Salas por código, arena, movimento sincronizado, pistola, dano, vida, abates, respawn | 2 navegadores em máquinas diferentes entram na mesma sala pelo código, se veem em movimento a ≥30 Hz e um elimina o outro; teste automatizado com 2 clientes passa; anti speed-hack e anti cadência verificados por teste |
| 2 — Combate | Sistema modular de armas, pistolas, rifles, snipers, faca, recuo por padrão, mira/zoom, feedback | ≥8 armas definidas só por dados + viewmodel; padrão de recuo reproduzível; teste de dano por região para todas |
| 3 — Animações e movimento | Agachar, corrida refinada, animações por categoria, troca de armas | Cada arma com draw/fire/reload/inspect próprios; transições sem saltos (blend ≥80 ms); hitbox agachada validada |
| 4 — Mapas e modos | 3 mapas, mata-mata, duelo, competitivo, gun game, treinamento | Cada mapa com colisão compartilhada testada e ≥60 FPS em qualidade média; cada modo com teste de condição de vitória |
| 5 — Interface e personalização | Menu completo, arsenal, inventário, skins, perfil, configurações | Contas no PostgreSQL; skin aplicada aparece para os outros jogadores |
| 6 — Competitivo | Ranking (rating tipo Glicko-2), progressão, histórico, economia, MVP | Rating muda conforme resultado e nível do adversário; compras só no período permitido (teste) |
| 7 — Polimento | Otimização, testes de carga, áudio, VFX, segurança | 10 jogadores com 150 ms de latência simulada sem dessincronização; orçamento de frame cumprido |

Metas de desempenho: 60 FPS em GPU integrada recente na qualidade baixa/média; banda < 20 KB/s por cliente com 10 jogadores.

## 8. Maiores desafios técnicos

1. **Latência pela internet** — previsão + reconciliação + lag compensation precisam concordar entre si; por isso a física é compartilhada e determinística em passo fixo.
2. **Hospedagem** — um servidor autoritativo precisa estar acessível na internet (túnel ou deploy; ver README).
3. **Assets profissionais** — modelos e animações de qualidade comercial exigem trabalho em Blender; a arquitetura isola isso para substituição sem retrabalho.
4. **JSON sobre WebSocket (TCP)** — simples e confiável, mas com overhead; em fases futuras: serialização binária e possivelmente WebTransport/UDP.
5. **Anti-trapaça no navegador** — o cliente é aberto; a defesa é o servidor decidir tudo que importa. Aimbot/wallhack exigem detecção estatística futura.
6. **Desempenho do WebGL** — merge de geometria por material, sombras limitadas e níveis de qualidade.
