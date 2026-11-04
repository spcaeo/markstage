// The phone check of the publish sheet: the entry's preview in a 390 px frame (shown small, as a phone, so the
// writer sees it too; a frame kept off screen would be throttled by the browser), measured in place by the preview
// agent (docs/API.md "Device checks in the frame"): wait for `ready`/`rendered`, send `measure`, read `measured`.
// Messages are taken from that frame and the preview origin only, and sent to that origin only.
import { ApiError } from '../api';
import * as api from './api';
import { el } from './ui';

export const PHONE = { width: 390, height: 844 };

export interface PhoneIssue {
  id: number;
  kind: 'overflow' | 'image' | 'tap' | 'font';
  text: string;
  label: string;
}
export type PhoneResult =
  | { kind: 'measured'; width: number; sideways: boolean; issues: PhoneIssue[] }
  | { kind: 'unavailable'; why: string }
  | { kind: 'unreachable'; why: string };

export interface PhoneCheck {
  /** the small phone: append it where it should show */
  frame: HTMLElement;
  result: Promise<PhoneResult>;
  destroy(): void;
}

/** Open the entry's preview at phone width and measure it. Resolves once (a timeout counts as unreachable). */
export function phoneCheck(c: string, id: string, timeoutMs = 45_000): PhoneCheck {
  const box = el('div.ms-adm-phone', { 'aria-label': 'The page on a phone (390 px wide)' });
  let stop = () => {};
  const result = new Promise<PhoneResult>((resolve) => {
    let done = false;
    const finish = (r: PhoneResult) => {
      if (done) return;
      done = true;
      stop();
      resolve(r);
    };
    void (async () => {
      let url: string;
      try {
        url = (await api.previewUrl(c, id)).url;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 409)) return finish({ kind: 'unavailable', why: e.message });
        return finish({ kind: 'unreachable', why: e instanceof Error ? e.message : String(e) });
      }
      if (done) return;
      const origin = new URL(url, location.href).origin;
      const frame = el('iframe.ms-adm-phone__frame', { src: url, title: 'Preview on a phone', tabindex: '-1', width: PHONE.width, height: PHONE.height, loading: 'eager' });
      box.append(frame);
      const run = Math.floor(Math.random() * 1e9);
      let asked = 0;
      const ask = () => {
        asked++;
        frame.contentWindow?.postMessage({ markstage: 'measure', run }, origin);
      };
      const onMessage = (ev: MessageEvent) => {
        if (ev.source !== frame.contentWindow || ev.origin !== origin) return;
        const m = ev.data as { markstage?: string; run?: number; result?: { width: number; sideways: boolean; issues: PhoneIssue[] } };
        if (m?.markstage === 'ready' || m?.markstage === 'rendered') ask();
        else if (m?.markstage === 'measured' && m.run === run && m.result) finish({ kind: 'measured', width: m.result.width, sideways: m.result.sideways, issues: m.result.issues ?? [] });
      };
      window.addEventListener('message', onMessage);
      const timer = window.setTimeout(() => finish({ kind: 'unreachable', why: asked ? 'The preview did not answer the check in time.' : 'The checks cannot reach this preview.' }), timeoutMs);
      stop = () => {
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
      };
    })();
  });
  return {
    frame: box,
    result,
    destroy: () => {
      stop();
      box.replaceChildren();
    },
  };
}
