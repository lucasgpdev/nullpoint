/**
 * Camada de aplicação: telas (menu, lobby, partida, resultados), modais e fluxo de rede.
 */
import {
  GAME_NAME,
  KILL_LIMIT_OPTIONS,
  MAPS,
  NAME_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
  TIME_LIMIT_OPTIONS_MIN,
  type MatchEnd,
  type MatchStart,
  type RoomState,
} from '@nullpoint/shared';
import { audio } from '../audio/AudioEngine';
import { settings, updateSettings, type Quality } from '../config/settings';
import { Game } from '../game/Game';
import { NetClient } from '../multiplayer/NetClient';
import { colorHex, fmtTime, h, toast, wireUiSounds } from './dom';

type Screen = 'menu' | 'lobby' | 'game';

const MODE_LABEL: Record<string, string> = { deathmatch: 'MATA-MATA' };

export class App {
  private readonly net = new NetClient();
  private readonly root: HTMLElement;
  private screen: Screen = 'menu';
  private game: Game | null = null;
  private results: MatchEnd | null = null;
  private resultsTimer = 0;
  private busy = false;
  private currentMatch: MatchStart | null = null;

  private readonly menuEl: HTMLElement;
  private readonly lobbyEl: HTMLElement;
  private readonly gameEl: HTMLElement;
  private readonly pauseEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private readonly connEl: HTMLElement;
  private readonly modalEl: HTMLElement;
  private readonly statusDot: HTMLElement;
  private nameInput!: HTMLInputElement;
  private codeInput!: HTMLInputElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.menuEl = this.buildMenu();
    this.lobbyEl = h('section', { class: 'screen screen-lobby' });
    this.gameEl = h('section', { class: 'screen screen-game' });
    this.pauseEl = h('div', { class: 'overlay overlay-pause' });
    this.resultsEl = h('div', { class: 'overlay overlay-results' });
    this.connEl = h('div', { class: 'overlay overlay-conn' }, h('div', { class: 'spinner' }), h('div', {}, 'CONEXÃO PERDIDA — RECONECTANDO…'));
    this.modalEl = h('div', { class: 'modal-host' });
    this.statusDot = h('span', { class: 'status-dot' });
    this.gameEl.append(this.pauseEl, this.resultsEl);
    root.append(this.menuEl, this.lobbyEl, this.gameEl, this.connEl, this.modalEl, h('div', { id: 'toasts' }));
    wireUiSounds(root);
    // Desbloqueia o áudio no primeiro gesto
    root.addEventListener('pointerdown', () => audio.unlock(), { once: false });

    this.net.handlers = {
      room: (s) => this.onRoom(s),
      matchStart: (m) => this.onMatchStart(m),
      matchEnd: (m) => this.onMatchEnd(m),
      snap: (s) => this.game?.onSnapshot(s),
      events: (e) => this.game?.onEvents(e),
      connection: (c) => {
        this.statusDot.className = `status-dot status-dot--${c}`;
        this.connEl.classList.toggle('is-on', c === 'reconnecting' && this.screen !== 'menu');
      },
      kicked: (r) => toast(`Desconectado: ${r}`, 'error'),
    };

    this.show('menu');
    void this.tryResume();
  }

  private async tryResume() {
    if (!this.net.token) return;
    try {
      const r = await this.net.rejoin();
      if (r.ok && r.room) {
        this.onRoom(r.room);
        this.show('lobby');
        toast('Sessão restaurada.');
      } else this.net.clearSession();
    } catch {
      /* servidor indisponível: permanece no menu */
    }
  }

  private show(s: Screen) {
    this.screen = s;
    this.menuEl.classList.toggle('is-on', s === 'menu');
    this.lobbyEl.classList.toggle('is-on', s === 'lobby');
    this.gameEl.classList.toggle('is-on', s === 'game');
    document.body.dataset.screen = s;
  }

  // ---------------- MENU ----------------
  private buildMenu(): HTMLElement {
    const params = new URLSearchParams(location.search);
    const invite = (params.get('sala') ?? '').toUpperCase().slice(0, ROOM_CODE_LENGTH);

    this.nameInput = h('input', {
      class: 'field__input',
      maxlength: NAME_MAX_LENGTH,
      placeholder: 'Seu codinome',
      value: settings.name,
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.nameInput.addEventListener('change', () => updateSettings({ name: this.nameInput.value.trim() }));

    this.codeInput = h('input', {
      class: 'field__input field__input--code',
      maxlength: ROOM_CODE_LENGTH,
      placeholder: '······',
      value: invite,
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.joinRoom();
    });

    const brand = h(
      'div',
      { class: 'brand' },
      h('div', { class: 'brand__mark', html: LOGO_SVG }),
      h('h1', { class: 'brand__word' }, GAME_NAME),
      h('p', { class: 'brand__tag' }, 'FPS TÁTICO · MULTIPLAYER EM TEMPO REAL'),
    );

    const createCard = h(
      'div',
      { class: 'card card--primary' },
      h('div', { class: 'card__kicker' }, '01 · ANFITRIÃO'),
      h('h2', { class: 'card__title' }, 'Criar sala privada'),
      h('p', { class: 'card__text' }, 'Gera um código exclusivo para compartilhar com seus amigos.'),
      h('button', { class: 'btn btn--primary', onclick: () => void this.createRoom() }, h('span', {}, 'CRIAR SALA'), h('i', { class: 'btn__arrow' })),
    );
    const joinCard = h(
      'div',
      { class: 'card' },
      h('div', { class: 'card__kicker' }, '02 · CONVIDADO'),
      h('h2', { class: 'card__title' }, 'Entrar com código'),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'CÓDIGO DA SALA'), this.codeInput),
      h('button', { class: 'btn', onclick: () => void this.joinRoom() }, h('span', {}, 'ENTRAR'), h('i', { class: 'btn__arrow' })),
    );

    const el = h(
      'section',
      { class: 'screen screen-menu' },
      h('div', { class: 'menu-bg' }, h('div', { class: 'menu-bg__grid' }), h('div', { class: 'menu-bg__glow' }), h('div', { class: 'menu-bg__word' }, 'NULL')),
      h(
        'div',
        { class: 'menu' },
        brand,
        h('label', { class: 'field field--name' }, h('span', { class: 'field__label' }, 'CODINOME'), this.nameInput),
        h('div', { class: 'menu__cards' }, createCard, joinCard),
        h(
          'div',
          { class: 'menu__footer' },
          h('button', { class: 'btn btn--ghost', onclick: () => this.openSettings() }, 'CONFIGURAÇÕES'),
          h('button', { class: 'btn btn--ghost', onclick: () => this.openControls() }, 'CONTROLES'),
          h('span', { class: 'menu__status' }, this.statusDotPlaceholder(), 'SERVIDOR'),
          h('span', { class: 'menu__ver' }, 'FASE 1 · v0.1'),
        ),
      ),
    );
    if (invite) setTimeout(() => this.nameInput.focus(), 50);
    return el;
  }

  private statusDotPlaceholder(): HTMLElement {
    // O ponto é criado depois do menu; usa um contêiner que recebe o ponto real.
    const span = h('span', { class: 'status-holder' });
    queueMicrotask(() => span.append(this.statusDot));
    return span;
  }

  private validName(): string | null {
    const n = this.nameInput.value.trim();
    if (n.length < 2) {
      toast('Escolha um codinome com pelo menos 2 caracteres.', 'error');
      this.nameInput.focus();
      return null;
    }
    updateSettings({ name: n });
    return n;
  }

  private async createRoom() {
    if (this.busy) return;
    const name = this.validName();
    if (!name) return;
    this.busy = true;
    try {
      const r = await this.net.create(name);
      if (!r.ok) return toast(r.error ?? 'Erro ao criar sala.', 'error');
      this.onRoom(r.room!);
      this.show('lobby');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      this.busy = false;
    }
  }

  private async joinRoom() {
    if (this.busy) return;
    const name = this.validName();
    if (!name) return;
    const code = this.codeInput.value.trim();
    if (code.length !== ROOM_CODE_LENGTH) {
      toast(`O código tem ${ROOM_CODE_LENGTH} caracteres.`, 'error');
      return this.codeInput.focus();
    }
    this.busy = true;
    try {
      const r = await this.net.join(name, code);
      if (!r.ok) return toast(r.error ?? 'Não foi possível entrar.', 'error');
      history.replaceState(null, '', location.pathname);
      this.onRoom(r.room!);
      this.show('lobby');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      this.busy = false;
    }
  }

  // ---------------- LOBBY ----------------
  private onRoom(s: RoomState) {
    this.renderLobby(s);
    if (this.results) this.renderResults();
    // Fim da tela de resultados: volta todos ao lobby
    if (s.phase === 'lobby' && this.game) this.leaveGameView();
  }

  private renderLobby(s: RoomState) {
    const me = s.players.find((p) => p.id === this.net.playerId);
    const isHost = s.hostId === this.net.playerId;
    const map = MAPS[s.config.map];
    const inviteUrl = `${location.origin}${location.pathname}?sala=${s.code}`;

    const copy = async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast(`${label} copiado.`);
      } catch {
        toast(`Não foi possível copiar. ${label}: ${text}`, 'error');
      }
    };

    const slots: HTMLElement[] = s.players.map((p) =>
      h(
        'li',
        { class: `slot${p.id === this.net.playerId ? ' slot--me' : ''}${p.connected ? '' : ' slot--off'}`, style: { '--c': colorHex(p.color) } },
        h('span', { class: 'slot__avatar' }, p.name.slice(0, 2).toUpperCase()),
        h('span', { class: 'slot__name' }, p.name, p.id === this.net.playerId ? h('em', {}, ' (você)') : null),
        p.isHost ? h('span', { class: 'tag' }, 'ANFITRIÃO') : null,
        h('span', { class: `slot__ping ${pingClass(p.ping)}` }, p.connected ? `${p.ping} ms` : 'reconectando'),
      ),
    );
    const free = s.config.maxPlayers - s.players.length;
    if (free > 0) {
      slots.push(
        h(
          'li',
          { class: 'slot slot--empty' },
          h('span', { class: 'slot__avatar' }, `+${free}`),
          h('span', { class: 'slot__name' }, free === 1 ? '1 vaga livre — envie o código da sala' : `${free} vagas livres — envie o código da sala`),
        ),
      );
    }

    const select = (label: string, value: number, options: number[], fmt: (n: number) => string, key: 'killLimit' | 'timeLimitMin' | 'maxPlayers') => {
      if (!isHost || s.phase !== 'lobby') return h('div', { class: 'cfg' }, h('span', { class: 'cfg__label' }, label), h('span', { class: 'cfg__value' }, fmt(value)));
      const sel = h('select', { class: 'cfg__select' }, ...options.map((o) => h('option', { value: o, selected: o === value }, fmt(o))));
      sel.addEventListener('change', () => this.net.configure({ [key]: Number(sel.value) }));
      return h('label', { class: 'cfg' }, h('span', { class: 'cfg__label' }, label), sel);
    };
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

    const phaseText = s.phase === 'playing' ? 'PARTIDA EM ANDAMENTO' : s.phase === 'ended' ? 'EXIBINDO RESULTADOS' : 'NO LOBBY';
    const connected = s.players.filter((p) => p.connected).length;

    let action: HTMLElement;
    if (s.phase === 'playing') {
      action = h('div', { class: 'waiting' }, h('span', { class: 'spinner spinner--sm' }), 'Partida em andamento — entrando…');
    } else if (isHost) {
      const btn = h('button', { class: 'btn btn--primary btn--xl', onclick: () => void this.startMatch(btn) }, h('span', {}, 'INICIAR PARTIDA'), h('i', { class: 'btn__arrow' }));
      action = h('div', { class: 'lobby__start' }, btn, connected < 2 ? h('p', { class: 'hint' }, 'Você pode iniciar sozinho para explorar o mapa. Amigos podem entrar a qualquer momento.') : null);
    } else {
      action = h('div', { class: 'waiting' }, h('span', { class: 'spinner spinner--sm' }), 'Aguardando o anfitrião iniciar a partida');
    }

    const rerender = this.lobbyEl.dataset.code === s.code;
    this.lobbyEl.dataset.code = s.code;
    this.lobbyEl.classList.toggle('no-anim', rerender);
    this.lobbyEl.textContent = '';
    this.lobbyEl.append(
      h('div', { class: 'menu-bg' }, h('div', { class: 'menu-bg__grid' })),
      h(
        'div',
        { class: 'lobby' },
        h(
          'header',
          { class: 'lobby__head' },
          h('div', {}, h('div', { class: 'card__kicker' }, `SALA PRIVADA · ${phaseText}`), h('div', { class: 'room-code' }, ...s.code.split('').map((c) => h('span', {}, c)))),
          h(
            'div',
            { class: 'lobby__share' },
            h('button', { class: 'btn btn--ghost', onclick: () => void copy(s.code, 'Código') }, 'COPIAR CÓDIGO'),
            h('button', { class: 'btn btn--ghost', onclick: () => void copy(inviteUrl, 'Link de convite') }, 'COPIAR CONVITE'),
          ),
        ),
        h(
          'div',
          { class: 'lobby__body' },
          h('div', { class: 'panel' }, h('div', { class: 'panel__title' }, `JOGADORES  ${s.players.length}/${s.config.maxPlayers}`), h('ul', { class: 'slots' }, ...slots)),
          h(
            'div',
            { class: 'panel panel--cfg' },
            h('div', { class: 'panel__title' }, 'CONFIGURAÇÃO DA PARTIDA'),
            h('div', { class: 'map-card' }, h('div', { class: 'map-card__art' }, h('div', { class: 'map-card__plan', html: MAP_PLAN_SVG })), h('div', { class: 'map-card__info' }, h('div', { class: 'map-card__name' }, map.name), h('div', { class: 'map-card__sub' }, map.subtitle))),
            h('div', { class: 'cfg' }, h('span', { class: 'cfg__label' }, 'MODO'), h('span', { class: 'cfg__value' }, MODE_LABEL[s.config.mode])),
            select('LIMITE DE ABATES', s.config.killLimit, [...KILL_LIMIT_OPTIONS], (n) => `${n} abates`, 'killLimit'),
            select('TEMPO', s.config.timeLimitMin, [...TIME_LIMIT_OPTIONS_MIN], (n) => `${n} min`, 'timeLimitMin'),
            select('MÁX. JOGADORES', s.config.maxPlayers, range(Math.max(ROOM_MIN_PLAYERS, s.players.length), ROOM_MAX_PLAYERS), (n) => `${n}`, 'maxPlayers'),
            !isHost ? h('p', { class: 'hint' }, 'Somente o anfitrião altera as configurações.') : null,
          ),
        ),
        h(
          'footer',
          { class: 'lobby__foot' },
          h('button', { class: 'btn btn--ghost', onclick: () => this.leaveRoom() }, 'SAIR DA SALA'),
          h('button', { class: 'btn btn--ghost', onclick: () => this.openSettings() }, 'CONFIGURAÇÕES'),
          action,
        ),
      ),
    );
    void me;
  }

  private async startMatch(btn: HTMLButtonElement) {
    btn.disabled = true;
    try {
      const r = await this.net.start();
      if (!r.ok) toast(r.error ?? 'Não foi possível iniciar.', 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  private leaveRoom() {
    this.leaveGameView();
    delete this.lobbyEl.dataset.code;
    this.net.leave();
    this.show('menu');
  }

  // ---------------- PARTIDA ----------------
  private onMatchStart(m: MatchStart) {
    // Reconexão durante a mesma partida: mantém o jogo atual em vez de recriá-lo.
    if (this.game && this.currentMatch && this.currentMatch.startedAt === m.startedAt) return;
    this.currentMatch = m;
    this.results = null;
    this.resultsEl.classList.remove('is-on');
    clearInterval(this.resultsTimer);
    this.game?.dispose();
    try {
      this.game = new Game(this.gameEl, this.net, m, { onLockChange: (l) => this.onLock(l) });
    } catch (e) {
      console.error(e);
      toast('WebGL indisponível neste navegador/computador.', 'error');
      return;
    }
    this.show('game');
    this.renderPause(true);
  }

  private onLock(locked: boolean) {
    if (locked) this.pauseEl.classList.remove('is-on');
    else if (!this.results) this.renderPause(false);
  }

  private renderPause(first: boolean) {
    const room = this.net.room;
    const isHost = room?.hostId === this.net.playerId;
    const resume = h('button', { class: 'btn btn--primary btn--xl', onclick: () => this.game?.input.requestLock() }, h('span', {}, first ? 'CLIQUE PARA JOGAR' : 'CONTINUAR'), h('i', { class: 'btn__arrow' }));
    this.pauseEl.textContent = '';
    this.pauseEl.append(
      h(
        'div',
        { class: 'pause' },
        h('div', { class: 'card__kicker' }, `${MODE_LABEL[room?.config.mode ?? 'deathmatch']} · ${MAPS[room?.config.map ?? 'foundry'].name} · SALA ${room?.code ?? ''}`),
        h('h2', { class: 'pause__title' }, first ? 'PRONTO PARA O COMBATE' : 'PAUSA'),
        h('p', { class: 'pause__note' }, first ? 'O mouse será capturado. Pressione ESC para liberar.' : 'A partida continua para os outros jogadores.'),
        resume,
        h(
          'div',
          { class: 'pause__row' },
          h('button', { class: 'btn btn--ghost', onclick: () => this.openSettings() }, 'CONFIGURAÇÕES'),
          h('button', { class: 'btn btn--ghost', onclick: () => this.openControls() }, 'CONTROLES'),
          isHost ? h('button', { class: 'btn btn--ghost btn--danger', onclick: () => this.net.endMatch() }, 'ENCERRAR PARTIDA') : null,
          h('button', { class: 'btn btn--ghost btn--danger', onclick: () => this.leaveRoom() }, 'SAIR DA SALA'),
        ),
        h('div', { class: 'pause__keys' }, ...KEYS.slice(0, 8).map(([k, d]) => h('span', {}, h('kbd', {}, k), d))),
      ),
    );
    this.pauseEl.classList.add('is-on');
  }

  private onMatchEnd(m: MatchEnd) {
    this.results = m;
    this.game?.input.exitLock();
    this.pauseEl.classList.remove('is-on');
    this.renderResults();
    this.resultsEl.classList.add('is-on');
    clearInterval(this.resultsTimer);
    this.resultsTimer = window.setInterval(() => this.renderResults(), 250);
  }

  private renderResults() {
    const m = this.results;
    if (!m) return;
    const room = this.net.room;
    const isHost = room?.hostId === this.net.playerId;
    const ranked = [...m.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const mvp = [...m.players].sort((a, b) => b.score - a.score || b.kills - a.kills)[0];
    const winner = m.players.find((p) => p.id === m.winnerId);
    const iWon = m.winnerId === this.net.playerId;
    const reason = { kills: 'Limite de abates atingido', time: 'Tempo esgotado', host: 'Encerrada pelo anfitrião', players: 'Jogadores insuficientes' }[m.reason];
    const left = m.backToLobbyAt - this.net.serverNow();

    const rerender = this.resultsEl.childElementCount > 0;
    this.resultsEl.textContent = '';
    this.resultsEl.append(
      h(
        'div',
        { class: `results${rerender ? ' no-anim' : ''}` },
        h('div', { class: 'card__kicker' }, `FIM DE PARTIDA · ${reason.toUpperCase()}`),
        h('h2', { class: `results__title${iWon ? ' is-win' : ''}` }, winner ? (iWon ? 'VITÓRIA' : `${winner.name} VENCEU`) : 'EMPATE'),
        mvp
          ? h('div', { class: 'mvp', style: { '--c': colorHex(mvp.color) } }, h('span', { class: 'mvp__badge' }, 'MVP'), h('span', { class: 'mvp__name' }, mvp.name), h('span', { class: 'mvp__stat' }, `${mvp.kills} abates · ${mvp.headshots} HS · ${mvp.score} pts`))
          : null,
        h(
          'table',
          { class: 'results__table' },
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'JOGADOR'), h('th', {}, 'ABATES'), h('th', {}, 'MORTES'), h('th', {}, 'ASSIST.'), h('th', {}, 'HS'), h('th', {}, 'K/D'), h('th', {}, 'PONTOS'))),
          h(
            'tbody',
            {},
            ...ranked.map((p, i) =>
              h(
                'tr',
                { class: p.id === this.net.playerId ? 'is-me' : '' },
                h('td', {}, String(i + 1)),
                h('td', {}, h('span', { class: 'dot', style: { background: colorHex(p.color) } }), p.name),
                h('td', {}, String(p.kills)),
                h('td', {}, String(p.deaths)),
                h('td', {}, String(p.assists)),
                h('td', {}, String(p.headshots)),
                h('td', {}, (p.kills / Math.max(1, p.deaths)).toFixed(2)),
                h('td', {}, String(p.score)),
              ),
            ),
          ),
        ),
        h(
          'div',
          { class: 'results__actions' },
          isHost
            ? h('button', { class: 'btn btn--primary btn--xl', onclick: (e: Event) => void this.startMatch(e.currentTarget as HTMLButtonElement) }, h('span', {}, 'JOGAR NOVAMENTE'), h('i', { class: 'btn__arrow' }))
            : h('div', { class: 'waiting' }, h('span', { class: 'spinner spinner--sm' }), 'Aguardando o anfitrião'),
          h('button', { class: 'btn btn--ghost', onclick: () => this.backToLobby() }, `VOLTAR AO LOBBY · ${fmtTime(left)}`),
        ),
      ),
    );
  }

  private backToLobby() {
    this.leaveGameView();
    if (this.net.room) this.renderLobby(this.net.room);
    this.show('lobby');
  }

  private leaveGameView() {
    clearInterval(this.resultsTimer);
    this.results = null;
    this.resultsEl.classList.remove('is-on');
    this.resultsEl.textContent = '';
    this.pauseEl.classList.remove('is-on');
    this.game?.dispose();
    this.game = null;
    this.currentMatch = null;
    if (this.screen === 'game') this.show('lobby');
  }

  // ---------------- MODAIS ----------------
  private modal(title: string, body: HTMLElement) {
    const close = () => {
      this.modalEl.textContent = '';
      this.modalEl.classList.remove('is-on');
    };
    this.modalEl.textContent = '';
    this.modalEl.append(
      h(
        'div',
        { class: 'modal', role: 'dialog', 'aria-label': title },
        h('header', { class: 'modal__head' }, h('h3', {}, title), h('button', { class: 'btn btn--icon', 'aria-label': 'Fechar', onclick: close }, '✕')),
        body,
      ),
    );
    this.modalEl.classList.add('is-on');
    this.modalEl.onclick = (e) => {
      if (e.target === this.modalEl) close();
    };
  }

  private openSettings() {
    const slider = (label: string, key: 'sensitivity' | 'fov' | 'masterVolume' | 'sfxVolume', min: number, max: number, step: number, fmt: (n: number) => string) => {
      const out = h('output', { class: 'set__out' }, fmt(settings[key]));
      const input = h('input', { type: 'range', min, max, step, value: settings[key], class: 'set__range' });
      input.addEventListener('input', () => {
        const v = Number(input.value);
        out.textContent = fmt(v);
        updateSettings({ [key]: v });
        this.game?.applySettings();
      });
      return h('label', { class: 'set' }, h('span', { class: 'set__label' }, label), input, out);
    };
    const toggle = (label: string, key: 'showFps' | 'invertY') => {
      const input = h('input', { type: 'checkbox', class: 'set__check', checked: settings[key] });
      input.addEventListener('change', () => updateSettings({ [key]: input.checked }));
      return h('label', { class: 'set set--toggle' }, h('span', { class: 'set__label' }, label), input);
    };
    const quality = h(
      'div',
      { class: 'seg' },
      ...(['low', 'medium', 'high'] as Quality[]).map((q) => {
        const b = h('button', { class: `seg__btn${settings.quality === q ? ' is-on' : ''}` }, { low: 'BAIXA', medium: 'MÉDIA', high: 'ALTA' }[q]);
        b.addEventListener('click', () => {
          updateSettings({ quality: q });
          quality.querySelectorAll('.seg__btn').forEach((x) => x.classList.toggle('is-on', x === b));
        });
        return b;
      }),
    );
    this.modal(
      'CONFIGURAÇÕES',
      h(
        'div',
        { class: 'modal__body' },
        h('div', { class: 'set-group' }, h('div', { class: 'set-group__title' }, 'CONTROLES'), slider('Sensibilidade do mouse', 'sensitivity', 0.1, 4, 0.05, (n) => n.toFixed(2)), toggle('Inverter eixo Y', 'invertY')),
        h('div', { class: 'set-group' }, h('div', { class: 'set-group__title' }, 'VÍDEO'), slider('Campo de visão (horizontal)', 'fov', 70, 110, 1, (n) => `${n}°`), h('div', { class: 'set' }, h('span', { class: 'set__label' }, 'Qualidade gráfica'), quality), h('p', { class: 'hint' }, 'A qualidade é aplicada a partir da próxima partida.'), toggle('Mostrar FPS e ping', 'showFps')),
        h('div', { class: 'set-group' }, h('div', { class: 'set-group__title' }, 'ÁUDIO'), slider('Volume geral', 'masterVolume', 0, 1, 0.01, (n) => `${Math.round(n * 100)}%`), slider('Efeitos sonoros', 'sfxVolume', 0, 1, 0.01, (n) => `${Math.round(n * 100)}%`)),
      ),
    );
  }

  private openControls() {
    this.modal('CONTROLES', h('div', { class: 'modal__body keys' }, ...KEYS.map(([k, d]) => h('div', { class: 'keys__row' }, h('kbd', {}, k), h('span', {}, d)))));
  }
}

const KEYS: [string, string][] = [
  ['W A S D', 'Movimentação'],
  ['MOUSE', 'Mirar / câmera'],
  ['CLIQUE ESQ.', 'Disparar'],
  ['R', 'Recarregar'],
  ['SHIFT', 'Correr'],
  ['ESPAÇO', 'Pular'],
  ['F', 'Inspecionar arma'],
  ['TAB', 'Placar'],
  ['ESC', 'Pausa / liberar mouse'],
];

function pingClass(p: number) {
  return p < 60 ? 'is-good' : p < 120 ? 'is-mid' : 'is-bad';
}

const LOGO_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="4"/><path d="M14 50 L50 14" stroke="#ff5a1f" stroke-width="5" stroke-linecap="square"/><rect x="30" y="2" width="4" height="10" fill="currentColor"/><rect x="30" y="52" width="4" height="10" fill="currentColor"/><rect x="2" y="30" width="10" height="4" fill="currentColor"/><rect x="52" y="30" width="10" height="4" fill="currentColor"/></svg>`;

/** Planta baixa estilizada do Foundry Yard (gerada a partir do layout real do mapa). */
const MAP_PLAN_SVG = (() => {
  const def = MAPS.foundry;
  const rects = def.boxes
    .filter((b) => b.mat !== 'floor' && b.mat !== 'roof' && b.max.y > 0.5)
    .map((b) => {
      const fill = b.mat === 'containerA' ? '#b64b24' : b.mat === 'containerB' ? '#2c6a74' : b.mat === 'crate' ? '#5f6b4c' : b.mat === 'trim' ? '#d9a21f' : '#8b857b';
      return `<rect x="${b.min.x + 26}" y="${b.min.z + 26}" width="${b.max.x - b.min.x}" height="${b.max.z - b.min.z}" fill="${fill}" opacity="0.9"/>`;
    })
    .join('');
  const spawns = def.spawns.map((s) => `<circle cx="${s.pos.x + 26}" cy="${s.pos.z + 26}" r="0.7" fill="#ff5a1f"/>`).join('');
  return `<svg viewBox="0 0 52 52" preserveAspectRatio="xMidYMid meet"><rect x="0" y="0" width="52" height="52" fill="#16191d"/>${rects}${spawns}</svg>`;
})();
