import type { Glyph, Point } from '../types.ts';
import { BOX_HEIGHT, GUIDES, frameFor, type FieldFrame } from './geometry.ts';
import { denormalizeStrokes } from './normalize.ts';
import type { PointerGate } from './pointer-gate.ts';

export interface FieldOptions {
  widthPx: number;
  pitchPx: number;
  gate: PointerGate;
  /** Called after a stroke ends, undo, or clear. */
  onChange(field: CaptureField): void;
  /** Called on pointerdown accepted by the gate (field becomes active). */
  onActivate(field: CaptureField): void;
  label: string;
}

/** Stroke width in CSS px for a pressure value (pen); `p` undefined → medium. */
const inkWidth = (pitch: number, p: number | undefined): number => pitch * 0.05 * (0.65 + 0.7 * (p ?? 0.5));

/**
 * One writing field: a canvas with guide lines that records strokes in CSS pixels.
 * Normalisation to glyph space happens on save (normalize.ts) using `frame`.
 */
export class CaptureField {
  readonly canvas: HTMLCanvasElement;
  readonly frame: FieldFrame;
  strokes: Point[][] = [];
  private current: Point[] | null = null;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private inkColor = '#1e1b1b';
  private guideColor = '#888';
  private baselineColor = '#7d8ca3';
  private readonly ac = new AbortController();

  constructor(private readonly opts: FieldOptions) {
    this.frame = frameFor(opts.pitchPx);
    const c = document.createElement('canvas');
    c.className = 'field-canvas';
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', opts.label);
    this.canvas = c;
    this.ctx = c.getContext('2d', { desynchronized: true }) as CanvasRenderingContext2D;
    this.resize(opts.widthPx);
    this.listen();
  }

  get width(): number {
    return this.opts.widthPx;
  }

  resize(widthPx: number): void {
    this.opts.widthPx = widthPx;
    const hgt = BOX_HEIGHT * this.opts.pitchPx;
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.style.width = `${widthPx}px`;
    this.canvas.style.height = `${hgt}px`;
    this.canvas.width = Math.round(widthPx * this.dpr);
    this.canvas.height = Math.round(hgt * this.dpr);
    this.redraw();
  }

  /** Show / continue editing a saved glyph. */
  setGlyph(g: Glyph | undefined): void {
    this.strokes = g ? denormalizeStrokes(g, this.frame) : [];
    this.current = null;
    this.redraw();
  }

  get isEmpty(): boolean {
    return this.strokes.length === 0;
  }

  undo(): boolean {
    if (!this.strokes.length) return false;
    this.strokes.pop();
    this.redraw();
    this.opts.onChange(this);
    return true;
  }

  clear(): void {
    this.strokes = [];
    this.current = null;
    this.redraw();
    this.opts.onChange(this);
  }

  destroy(): void {
    this.ac.abort();
  }

  private readColors(): void {
    const cs = getComputedStyle(this.canvas);
    this.inkColor = cs.getPropertyValue('--ink').trim() || this.inkColor;
    this.guideColor = cs.getPropertyValue('--guide').trim() || this.guideColor;
    this.baselineColor = cs.getPropertyValue('--guide-strong').trim() || this.baselineColor;
  }

  redraw(): void {
    if (this.canvas.isConnected) this.readColors();
    const { ctx, dpr } = this;
    const w = this.opts.widthPx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, this.canvas.height / dpr);
    for (const g of GUIDES) {
      const y = Math.round(this.frame.baselinePx + g.y * this.frame.pitchPx) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      // Notebook look: faint ruled lines, a slightly stronger baseline, dotted helper lines.
      ctx.lineWidth = g.kind === 'baseline' ? 1.25 : 1;
      ctx.strokeStyle = g.kind === 'baseline' ? this.baselineColor : this.guideColor;
      ctx.globalAlpha = g.kind === 'baseline' ? 1 : g.kind === 'ruled' ? 0.9 : 0.75;
      ctx.setLineDash(g.kind === 'baseline' || g.kind === 'ruled' ? [] : [1, 4]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    for (const s of this.strokes) this.drawStroke(s, 0);
    if (this.current) this.drawStroke(this.current, 0);
  }

  /** Draw stroke segments from index `from` (incremental drawing while writing). */
  private drawStroke(s: Point[], from: number): void {
    const { ctx } = this;
    ctx.strokeStyle = this.inkColor;
    ctx.fillStyle = this.inkColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0].x, s[0].y, inkWidth(this.opts.pitchPx, s[0].p) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    for (let i = Math.max(1, from); i < s.length; i++) {
      const a = s[i - 1];
      const b = s[i];
      ctx.beginPath();
      ctx.lineWidth = inkWidth(this.opts.pitchPx, ((a.p ?? 0.5) + (b.p ?? 0.5)) / 2);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  private point(e: PointerEvent, rect: DOMRect): Point {
    const pt: Point = {
      x: Math.round((e.clientX - rect.left) * 100) / 100,
      y: Math.round((e.clientY - rect.top) * 100) / 100,
    };
    // Only the pen reports real pressure (mouse: constant 0.5, touch: often 0 or 1).
    if (e.pointerType === 'pen' && e.pressure > 0) pt.p = Math.round(e.pressure * 100) / 100;
    return pt;
  }

  private listen(): void {
    const c = this.canvas;
    const sig = { signal: this.ac.signal };
    let rect = c.getBoundingClientRect();

    const cancel = (): void => {
      this.current = null;
      this.redraw();
    };

    c.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (!this.opts.gate.down(e, cancel)) return;
        e.preventDefault();
        rect = c.getBoundingClientRect();
        try {
          c.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic events */
        }
        this.opts.onActivate(this);
        this.current = [this.point(e, rect)];
        this.drawStroke(this.current, 0);
      },
      sig,
    );

    c.addEventListener(
      'pointermove',
      (e) => {
        if (!this.current || !this.opts.gate.owns(e)) return;
        e.preventDefault();
        const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const from = this.current.length;
        for (const ce of evs.length ? evs : [e]) this.current.push(this.point(ce, rect));
        this.drawStroke(this.current, from);
      },
      sig,
    );

    const finish = (e: PointerEvent, keep: boolean): void => {
      if (!this.opts.gate.owns(e)) {
        this.opts.gate.end(e);
        return;
      }
      this.opts.gate.end(e);
      const s = this.current;
      this.current = null;
      if (!s) return;
      if (keep && e.type === 'pointerup') {
        const last = this.point(e, rect);
        const end = s[s.length - 1];
        if (last.x !== end.x || last.y !== end.y) s.push(last);
      }
      if (keep) {
        this.strokes.push(s);
        this.opts.onChange(this);
      } else this.redraw();
    };
    c.addEventListener('pointerup', (e) => finish(e, true), sig);
    // iPadOS sends pointercancel e.g. when a system gesture starts; keep what was written.
    c.addEventListener('pointercancel', (e) => finish(e, e.pointerType === 'pen'), sig);
    // Block long-press callouts / text selection / double-tap zoom on iOS.
    c.addEventListener('touchstart', (e) => e.preventDefault(), { ...sig, passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault(), sig);
  }
}
