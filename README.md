# NULLPOINT — FPS 3D multiplayer no navegador

FPS competitivo original em **TypeScript + Three.js** com **servidor autoritativo Node.js + Socket.IO**.
Esta entrega corresponde à **Fase 1 — MVP multiplayer**: salas privadas por código, arena 3D, movimentação sincronizada, câmera em primeira pessoa, pistola funcional, dano, vida, abates e respawn — entre jogadores reais conectados ao servidor.

> Arquitetura completa, cronograma de fases e critérios de conclusão: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Requisitos

- **Node.js 20 ou superior** (testado com Node 22) e npm.
- Navegador com WebGL 2 (Chrome, Edge, Firefox ou Safari recentes).

## Instalação

```bash
npm install
```

## Rodar

### Modo produção (recomendado para jogar)

```bash
npm run build      # compila cliente e servidor
npm start          # sobe tudo em http://localhost:3000
```

O servidor entrega o jogo e o WebSocket na **mesma porta**. A porta muda com `PORT=4000 npm start`.

### Modo desenvolvimento (recarrega ao editar)

```bash
npm run dev
```

- Cliente (Vite): http://localhost:5173 — encaminha o WebSocket para o servidor.
- Servidor: http://localhost:3000 (reinicia ao salvar).

## Jogar com amigos pela internet

O servidor precisa estar acessível para todos. Três caminhos, do mais rápido ao mais robusto:

1. **Túnel (sem configurar roteador)** — com o jogo rodando (`npm start`), instale o [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) e rode:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   Ele imprime um endereço `https://….trycloudflare.com`. Envie para os amigos. (ngrok funciona do mesmo jeito.)
2. **Redirecionamento de porta** — libere a porta TCP 3000 no roteador para o seu PC e envie `http://SEU_IP_PUBLICO:3000`.
3. **Servidor na nuvem** — o `Dockerfile` gera uma imagem única (cliente + servidor). Hospede em um provedor com região próxima dos jogadores (ex.: São Paulo) e **uma única instância** (as salas ficam em memória).

Depois: um jogador clica **Criar sala**, usa **Copiar convite** e envia o link — quem abrir o link já cai com o código preenchido. Ou digite o código de 6 caracteres em **Entrar com código**.

> Para testar sozinho no mesmo PC: abra duas abas/janelas. Cada aba é um jogador diferente.

## Controles

| Tecla | Ação |
|---|---|
| W A S D | Mover |
| Mouse | Mirar |
| Clique esquerdo | Disparar (semiautomática: um clique = um tiro) |
| R | Recarregar |
| Shift | Correr (piora a precisão) |
| Espaço | Pular |
| F | Inspecionar arma |
| Tab | Placar |
| Esc | Pausa / liberar o mouse |

Clique direito (mira), Ctrl (agachar), 1-2-3 (troca de armas) e G (granada) entram nas Fases 2–3, quando houver armas e mecânicas para eles.

## O que existe na Fase 1

**Multiplayer**
- Salas privadas com código de 6 caracteres (sem caracteres ambíguos), link de convite, anfitrião, limite de jogadores, limite de abates e de tempo.
- Lista de jogadores com ping, status de conexão, migração de anfitrião.
- **Reconexão**: se a conexão cair, o jogador volta ao mesmo lugar (mesmas estatísticas) em até 30 s.
- Entrada com partida em andamento.

**Rede (servidor autoritativo)**
- Simulação a 60 Hz no servidor, snapshots a 30 Hz, comandos de entrada em lotes a ~30 Hz.
- Previsão local + reconciliação (física idêntica no cliente e no servidor, em `shared/`).
- Interpolação dos outros jogadores com 100 ms de atraso.
- **Compensação de latência**: o servidor rebobina as hitboxes até o instante que o atirador via (máx. 250 ms).
- Sincronização de relógio por RTT.

**Anti-trapaça**
- O cliente envia só botões e ângulos; posição, velocidade, colisão, dano e abates são decididos pelo servidor.
- Orçamento de comandos por tempo real (speed hack não funciona), validação de cadência, munição, recarga e modo semiautomático.
- Dispersão calculada no servidor com semente determinística.
- Validação de todos os payloads, rate limiting por evento e desconexão de clientes abusivos; limite de 16 KB por mensagem.

**Combate**
- P9 WARDEN: 12+48 tiros, 31 de dano, headshot ×3,6 (elimina com um tiro), pernas ×0,75, queda de dano por distância, dispersão por movimento/corrida/pulo/sequência de tiros, recuo visual.
- Hitboxes de cabeça, tronco e pernas. Assistências (≥ 40 de dano nos últimos 10 s).
- Feed de abates, marcador de acerto (normal/headshot/abate), indicador de direção do dano, vinheta de vida baixa, câmera de eliminação, respawn em 3 s com proteção de 1,2 s (cancelada ao atirar), spawn longe dos inimigos.

**Visual e áudio**
- Arena **FOUNDRY YARD** (50×50 m, simetria rotacional): plataforma central com escadas, contêineres, caixas, galpões cobertos, coberturas e rotas alternativas.
- Texturas procedurais com normal maps, sombras, iluminação PBR com mapa de ambiente, neblina e horizonte industrial.
- Pistola e braços em 1ª pessoa com slide, carregador, miras e cápsulas animados; animações de saque, disparo, recarga (com troca de carregador), inspeção, balanço, corrida e aterrissagem.
- Personagem em 3ª pessoa articulado: caminhada em qualquer direção, mira acompanhando o pitch, pulo, recuo, recarga e queda ao morrer.
- Sons sintetizados (originais) com áudio 3D HRTF e abafamento atrás de paredes.
- Configurações: sensibilidade, FOV, qualidade gráfica (baixa/média/alta), volumes, FPS/ping.

## Testes

```bash
npm test            # 25 testes: física, armas, raycast, validação + integração com 2 clientes Socket.IO reais
npm run build && npm run test:e2e   # 2 navegadores Chrome reais jogando uma partida completa
```

O teste de integração (`tests/multiplayer.test.ts`) sobe o servidor e conecta dois clientes: cria sala, entra por código, valida permissões do anfitrião, movimento visto pelo outro jogador, headshot com eliminação, respawn, **anti-cadência**, **anti speed hack**, payloads inválidos, **reconexão** e fim de partida por limite de abates.

O teste E2E (`tests/e2e/two-browsers.mjs`) abre **dois processos de Chrome independentes**: cria a sala no primeiro, entra pelo link de convite no segundo, inicia, anda, atira, elimina, confere respawn e tela de resultados, e salva capturas em `tests/e2e/screenshots/`. Ele usa `/usr/bin/google-chrome` (ou `CHROME_PATH=...`). Como o Chrome headless não concede captura do mouse e os spawns são aleatórios, o teste marca a entrada como capturada e posiciona os jogadores num corredor livre por um gancho de teste do servidor que só existe com `NULLPOINT_TEST_HOOKS=1`.

## Estrutura

```
shared/src     código usado pelos dois lados: constantes, protocolo, física, colisão, armas, mapas, validação
server/src     index (HTTP + Socket.IO) · rooms/ · matches/ · players/ · combat/ · security/
client/src     main · game/ · player/ · weapons/ · animations/ · maps/ · multiplayer/ · audio/ · effects/ · ui/ · config/
tests/         unitários, integração e E2E
docs/          arquitetura
assets/        pipeline futuro de modelos/texturas/sons (ver assets/README.md)
```

**Adicionar uma arma:** criar a `WeaponDef` em `shared/src/weapons.ts` (dano, cadência, dispersão, recuo, carregador…) e um `ViewModel` no cliente. **Trocar modelos:** implementar a interface `ViewModel` com um GLB — as mecânicas não mudam.

## Limitações conhecidas (Fase 1)

- Modelos 3D são construídos por geometria em código (não há Blender neste ambiente). A interface `ViewModel`/`CharacterModel` está pronta para receber GLB com esqueleto.
- Hitboxes são caixas alinhadas aos eixos (não giram com o corpo); agachar ainda não existe.
- As salas ficam em memória: reiniciar o servidor encerra todas. Contas, perfis e estatísticas persistentes (PostgreSQL) chegam nas Fases 5–6.
- Mensagens em JSON sobre WebSocket (TCP). Serialização binária fica para a Fase 7.
- Os testes rodaram em uma única máquina (localhost) com renderização por software; latência real de internet e o desempenho em GPU de verdade ainda precisam ser medidos com vocês jogando. O `Dockerfile` não foi testado neste ambiente.
- Uma única arma e um único mapa/modo, conforme o escopo da Fase 1.
