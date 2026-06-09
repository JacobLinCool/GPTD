import { Container, Graphics, Text } from 'pixi.js'
import { COLORS } from '../config'
import { label } from '../ui/theme'

interface Beam {
  x: number
  y: number
  tx: number
  ty: number
  color: number
  life: number
  max: number
}
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: number
  size: number
}
interface Popup {
  t: Text
  vy: number
  life: number
  max: number
}

export class FxManager {
  readonly view = new Container()
  private beamsG = new Graphics()
  private partG = new Graphics()
  private popupHost = new Container()
  private beams: Beam[] = []
  private particles: Particle[] = []
  private popups: Popup[] = []
  private pool: Text[] = []

  constructor() {
    this.view.addChild(this.beamsG, this.partG, this.popupHost)
    this.view.eventMode = 'none'
  }

  fire(x: number, y: number, tx: number, ty: number, color: number): void {
    this.beams.push({ x, y, tx, ty, color, life: 0.11, max: 0.11 })
  }

  private burst(x: number, y: number, color: number, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = speed * (0.4 + Math.random() * 0.8)
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 20,
        life: 0.5 + Math.random() * 0.3,
        max: 0.8,
        color,
        size: 1 + Math.random() * 2,
      })
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400)
  }

  private popup(x: number, y: number, text: string, color: number, size = 14): void {
    const t = this.pool.pop() ?? label('', 14)
    t.text = text
    t.style.fill = color
    t.style.fontSize = size
    t.style.fontWeight = 'bold'
    t.anchor.set(0.5)
    t.x = x
    t.y = y
    t.alpha = 1
    this.popupHost.addChild(t)
    this.popups.push({ t, vy: 36, life: 0.9, max: 0.9 })
  }

  serve(x: number, y: number, kind: 'good' | 'bad' | 'unsafe', amount: number): void {
    if (kind === 'good') {
      this.popup(x, y - 6, '+$' + amount, COLORS.cash, 14)
      this.burst(x, y, COLORS.cash, 7, 90)
    } else if (kind === 'bad') {
      this.popup(x, y - 6, 'BAD', COLORS.warn, 13)
      this.burst(x, y, COLORS.warn, 5, 70)
    } else {
      this.popup(x, y - 6, 'UNSAFE!', COLORS.danger, 14)
      this.burst(x, y, COLORS.danger, 9, 110)
    }
  }

  cache(x: number, y: number): void {
    this.popup(x, y - 6, 'HIT', COLORS.cooling, 12)
    this.burst(x, y, COLORS.cooling, 5, 80)
  }

  leak(x: number, y: number, unsafe: boolean): void {
    this.popup(x, y - 6, unsafe ? 'BREACH' : 'LEAK', COLORS.danger, 13)
    this.burst(x, y, COLORS.danger, 10, 120)
  }

  update(dt: number): void {
    // beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].life -= dt
      if (this.beams[i].life <= 0) this.beams.splice(i, 1)
    }
    this.beamsG.clear()
    for (const b of this.beams) {
      const a = b.life / b.max
      this.beamsG
        .moveTo(b.x, b.y)
        .lineTo(b.tx, b.ty)
        .stroke({ width: 2, color: b.color, alpha: 0.35 + a * 0.5 })
      this.beamsG.circle(b.tx, b.ty, 3 + (1 - a) * 3).stroke({ width: 1.5, color: b.color, alpha: a * 0.8 })
    }
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dt
      if (p.life <= 0) {
        this.particles.splice(i, 1)
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 140 * dt
    }
    this.partG.clear()
    for (const p of this.particles) {
      const a = p.life / p.max
      this.partG.rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size).fill({ color: p.color, alpha: a })
    }
    // popups
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pu = this.popups[i]
      pu.life -= dt
      pu.t.y -= pu.vy * dt
      pu.t.alpha = Math.max(0, pu.life / pu.max)
      if (pu.life <= 0) {
        this.popupHost.removeChild(pu.t)
        this.pool.push(pu.t)
        this.popups.splice(i, 1)
      }
    }
  }
}
