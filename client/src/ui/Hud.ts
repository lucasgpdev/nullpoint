import { MAX_HEALTH, type PlayerInfo } from '@nullpoint/shared';
import { colorHex, fmtTime, h } from './dom';

interface FeedEntry {
  el: HTMLElement;
  until: number;
}

/** HUD da partida: vida, munição, mira dinâmica, cronômetro, placar, feed, indicadores de dano. */
export class Hud {
  readonly root: HTMLElement;
  private hpNum: HTMLElement;
  private hpBar: HTMLElement;
  private ammoMag: HTMLElement;
  private ammoRes: HTMLElement;
  private weaponName: HTMLElement;
  private reloadBar: HTMLElement;
  private crosshair: HTMLElement;
  private hitmarker: HTMLElement;
  private timer: HTMLElement;
  private scoreMine: HTMLElement;
  private scoreLeader: HTMLElement;
  private alive: HTMLElement;
  private feed: HTMLElement;
  private feedEntries: FeedEntry[] = [];
  private center: HTMLElement;
  private centerSub: HTMLElement;
  private banner: HTMLElement;
  private vignette: HTMLElement;
  private indicators: HTMLElement;
  private netStats: HTMLElement;
  private protect: HTMLElement;
  private scoreboard: HTMLElement;
  private scoreRows: HTMLElement;
  private hitTimer = 0;
  private bannerTimer = 0;
  private lastHp = -1;

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'hud' });
    parent.append(this.root);

    this.vignette = h('div', { class: 'hud-vignette' });
    this.indicators = h('div', { class: 'hud-indicators' });
    this.crosshair = h('div', { class: 'crosshair' }, h('i', { class: 'ch-t' }), h('i', { class: 'ch-b' }), h('i', { class: 'ch-l' }), h('i', { class: 'ch-r' }), h('i', { class: 'ch-dot' }));
    this.hitmarker = h('div', { class: 'hitmarker' }, h('i'), h('i'), h('i'), h('i'));

    this.hpNum = h('span', { class: 'hud-hp__num' }, '100');
    this.hpBar = h('div', { class: 'hud-hp__fill' });
    const hp = h('div', { class: 'hud-panel hud-hp' }, h('div', { class: 'hud-label' }, 'VIDA'), this.hpNum, h('div', { class: 'hud-hp__bar' }, this.hpBar));

    this.weaponName = h('div', { class: 'hud-label' }, '—');
    this.ammoMag = h('span', { class: 'hud-ammo__mag' }, '12');
    this.ammoRes = h('span', { class: 'hud-ammo__res' }, '48');
    this.reloadBar = h('div', { class: 'hud-ammo__reload' });
    const ammo = h('div', { class: 'hud-panel hud-ammo' }, this.weaponName, h('div', { class: 'hud-ammo__row' }, this.ammoMag, h('span', { class: 'hud-ammo__sep' }, '/'), this.ammoRes), this.reloadBar);

    this.timer = h('div', { class: 'hud-timer' }, '0:00');
    this.scoreMine = h('div', { class: 'hud-score__mine' });
    this.scoreLeader = h('div', { class: 'hud-score__leader' });
    this.alive = h('div', { class: 'hud-score__alive' });
    const top = h('div', { class: 'hud-top' }, this.scoreMine, this.timer, this.scoreLeader);

    this.feed = h('div', { class: 'hud-feed' });
    this.center = h('div', { class: 'hud-center' });
    this.centerSub = h('div', { class: 'hud-center__sub' });
    this.banner = h('div', { class: 'hud-banner' });
    this.netStats = h('div', { class: 'hud-net' });
    this.protect = h('div', { class: 'hud-protect' }, 'PROTEÇÃO DE SPAWN');

    this.scoreRows = h('tbody');
    this.scoreboard = h(
      'div',
      { class: 'scoreboard' },
      h('div', { class: 'scoreboard__head' }, h('span', {}, 'PLACAR'), h('span', { class: 'scoreboard__mode' }, 'MATA-MATA · FOUNDRY YARD')),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'JOGADOR'), h('th', {}, 'A'), h('th', {}, 'M'), h('th', {}, 'AS'), h('th', {}, 'HS'), h('th', {}, 'PTS'), h('th', {}, 'PING'))), this.scoreRows),
    );

    this.root.append(this.vignette, this.indicators, this.crosshair, this.hitmarker, hp, ammo, top, this.alive, this.feed, this.center, this.centerSub, this.banner, this.netStats, this.protect, this.scoreboard);
  }

  setHealth(hp: number): void {
    if (hp === this.lastHp) return;
    this.lastHp = hp;
    this.hpNum.textContent = String(Math.max(0, Math.round(hp)));
    const f = Math.max(0, hp) / MAX_HEALTH;
    this.hpBar.style.transform = `scaleX(${f})`;
    this.root.classList.toggle('hud--low', hp > 0 && hp <= 30);
  }

  setAmmo(name: string, mag: number, reserve: number, reload: number): void {
    this.weaponName.textContent = name;
    this.ammoMag.textContent = String(mag);
    this.ammoRes.textContent = String(reserve);
    this.ammoMag.classList.toggle('is-empty', mag === 0);
    this.reloadBar.style.transform = `scaleX(${reload})`;
    this.reloadBar.style.opacity = reload > 0 ? '1' : '0';
  }

  /** Abertura da mira em pixels a partir da dispersão atual (rad) e do FOV. */
  setCrosshair(spreadRad: number, fovDeg: number, visible: boolean): void {
    const px = (Math.tan(spreadRad) / Math.tan((fovDeg * Math.PI) / 360)) * (window.innerHeight / 2);
    const gap = 4 + Math.min(60, px);
    this.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    this.crosshair.style.opacity = visible ? '1' : '0';
  }

  hit(head: boolean, kill: boolean): void {
    this.hitmarker.classList.remove('is-on', 'is-head', 'is-kill');
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('is-on');
    if (head) this.hitmarker.classList.add('is-head');
    if (kill) this.hitmarker.classList.add('is-kill');
    this.hitTimer = kill ? 0.45 : 0.22;
  }

  hurt(angle: number, dmg: number): void {
    this.vignette.classList.remove('is-on');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('is-on');
    const ind = h('div', { class: 'hud-indicator', style: { transform: `rotate(${angle}rad)`, opacity: String(Math.min(1, 0.4 + dmg / 60)) } }, h('i'));
    this.indicators.append(ind);
    setTimeout(() => ind.remove(), 1200);
  }

  setTimer(ms: number): void {
    this.timer.textContent = fmtTime(ms);
    this.timer.classList.toggle('is-urgent', ms < 30000);
  }

  setScore(me: PlayerInfo | undefined, players: PlayerInfo[], killLimit: number, aliveCount: number): void {
    const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const leader = sorted[0];
    this.scoreMine.innerHTML = `<b>${me?.kills ?? 0}</b><small>/ ${killLimit}</small>`;
    if (leader && me && leader.id !== me.id) {
      this.scoreLeader.textContent = '';
      this.scoreLeader.append(h('span', { class: 'dot', style: { background: colorHex(leader.color) } }), `${leader.name}  ${leader.kills}`);
    } else {
      this.scoreLeader.textContent = me && leader ? 'VOCÊ LIDERA' : '';
    }
    this.alive.textContent = `${aliveCount} VIVOS · ${players.filter((p) => p.connected).length} JOGADORES`;
  }

  killfeed(killer: PlayerInfo | undefined, victim: PlayerInfo | undefined, head: boolean, myId: number, assist?: PlayerInfo): void {
    const self = killer && victim && killer.id === victim.id;
    const name = (p: PlayerInfo | undefined) => h('span', { class: 'feed-name', style: { color: p ? colorHex(p.color) : '#ccc' } }, p ? p.name : '?');
    const el = h(
      'div',
      { class: `feed-row${killer?.id === myId || victim?.id === myId ? ' is-mine' : ''}` },
      self ? null : name(killer),
      assist ? h('span', { class: 'feed-assist' }, `+ ${assist.name}`) : null,
      h('span', { class: 'feed-icon' }, self ? 'QUEDA' : 'P9'),
      head ? h('span', { class: 'feed-head', title: 'Headshot' }) : null,
      name(victim),
    );
    this.feed.prepend(el);
    this.feedEntries.push({ el, until: performance.now() + 6000 });
    while (this.feed.children.length > 6) this.feed.lastElementChild?.remove();
  }

  setCenter(text: string, sub = ''): void {
    this.center.textContent = text;
    this.centerSub.textContent = sub;
    this.center.classList.toggle('is-on', !!text);
    this.centerSub.classList.toggle('is-on', !!sub);
  }

  showBanner(text: string, kind: 'kill' | 'head' | 'info' = 'kill'): void {
    this.banner.textContent = text;
    this.banner.className = `hud-banner is-on hud-banner--${kind}`;
    this.bannerTimer = 1.6;
  }

  setNet(fps: number, ping: number, show: boolean): void {
    this.netStats.style.display = show ? '' : 'none';
    if (show) this.netStats.textContent = `${fps} FPS · ${Math.round(ping)} MS`;
  }

  setProtected(on: boolean): void {
    this.protect.classList.toggle('is-on', on);
  }

  setAliveUi(alive: boolean): void {
    this.root.classList.toggle('hud--dead', !alive);
  }

  showScoreboard(show: boolean, players: PlayerInfo[], myId: number, hpById: Map<number, number>): void {
    this.scoreboard.classList.toggle('is-on', show);
    if (!show) return;
    const sorted = [...players].sort((a, b) => b.score - a.score || b.kills - a.kills);
    this.scoreRows.textContent = '';
    for (const p of sorted) {
      const dead = (hpById.get(p.id) ?? 1) <= 0;
      this.scoreRows.append(
        h(
          'tr',
          { class: `${p.id === myId ? 'is-me' : ''} ${p.connected ? '' : 'is-off'} ${dead ? 'is-dead' : ''}` },
          h('td', {}, h('span', { class: 'dot', style: { background: colorHex(p.color) } }), p.name, p.isHost ? h('span', { class: 'tag' }, 'HOST') : null, p.connected ? null : h('span', { class: 'tag tag--warn' }, 'RECONECTANDO')),
          h('td', {}, String(p.kills)),
          h('td', {}, String(p.deaths)),
          h('td', {}, String(p.assists)),
          h('td', {}, String(p.headshots)),
          h('td', {}, String(p.score)),
          h('td', {}, p.connected ? String(p.ping) : '—'),
        ),
      );
    }
  }

  update(dt: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitmarker.classList.remove('is-on');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('is-on');
    }
    const now = performance.now();
    for (const f of this.feedEntries) if (now > f.until) f.el.classList.add('is-old');
    this.feedEntries = this.feedEntries.filter((f) => now <= f.until + 400 || (f.el.remove(), false));
  }

  dispose(): void {
    this.root.remove();
  }
}
