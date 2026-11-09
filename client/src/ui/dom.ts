import { audio } from '../audio/AudioEngine';

/** Criação de elementos com atributos e filhos de forma declarativa. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else (el.style as unknown as Record<string, string>)[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const colorHex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function escapeText(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Sons de interface em todos os botões. */
export function wireUiSounds(root: HTMLElement): void {
  root.addEventListener('pointerenter', (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLButtonElement && !t.disabled) audio.play2D('uiHover', 0.5, 1, true);
  }, true);
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button');
    if (t && !t.disabled) audio.play2D('uiClick', 0.7, 1, true);
  }, true);
}

export function toast(msg: string, kind: 'info' | 'error' = 'info'): void {
  const host = document.getElementById('toasts')!;
  const el = h('div', { class: `toast toast--${kind}` }, msg);
  host.append(el);
  setTimeout(() => el.classList.add('toast--out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
