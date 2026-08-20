import { useEffect, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';
import styles from './AmbientBackground.module.css';

interface AmbientBackgroundProps {
  intensity?: number;
  radius?: number;
}

const GRID = 26;
const BASE_RADIUS = 1;
const MAX_RADIUS_MULT = 2.2;
const MAX_OPACITY = 0.55;
const DISPLACEMENT = 7;
const STIFFNESS = 0.08;
const DAMPING = 0.82;
const SETTLE_EPSILON = 0.02;
const RESIZE_DEBOUNCE_MS = 150;

interface Dot {
  homeX: number;
  homeY: number;
  offsetX: number;
  offsetY: number;
  velX: number;
  velY: number;
  radius: number;
  opacity: number;
}

export default function AmbientBackground({ intensity = 1, radius = 180 }: AmbientBackgroundProps) {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);
  const colsRef = useRef(0);
  const rowsRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const activeRef = useRef<Set<number>>(new Set());
  const rafRef = useRef<number | null>(null);
  const dotColorRef = useRef({ r: 233, g: 233, b: 237, a: 0.13 });
  const propsRef = useRef({ intensity, radius });
  propsRef.current = { intensity, radius };

  // The color lives in CSS (shared with the rest of the theme system) but a
  // <canvas> can't read a custom property directly, so it's parsed here and
  // re-read whenever the theme flips.
  useEffect(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ambient-grid-dot').trim();
    const m = raw.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+([\d.]+))?\s*\)/);
    if (m) {
      dotColorRef.current = {
        r: Number(m[1]),
        g: Number(m[2]),
        b: Number(m[3]),
        a: m[4] !== undefined ? Number(m[4]) : 1,
      };
    }
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function buildDots(w: number, h: number) {
      const cols = Math.ceil(w / GRID) + 1;
      const rows = Math.ceil(h / GRID) + 1;
      colsRef.current = cols;
      rowsRef.current = rows;
      const dots: Dot[] = new Array(cols * rows);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          dots[row * cols + col] = {
            homeX: col * GRID,
            homeY: row * GRID,
            offsetX: 0,
            offsetY: 0,
            velX: 0,
            velY: 0,
            radius: BASE_RADIUS,
            opacity: dotColorRef.current.a,
          };
        }
      }
      dotsRef.current = dots;
      activeRef.current.clear();
    }

    function drawStatic() {
      const { w, h } = sizeRef.current;
      const { r, g, b, a } = dotColorRef.current;
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = `rgba(${r},${g},${b},${a})`;
      for (const dot of dotsRef.current) {
        ctx!.beginPath();
        ctx!.arc(dot.homeX, dot.homeY, BASE_RADIUS, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      sizeRef.current = { w, h };
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildDots(w, h);
      if (reducedMotion) drawStatic();
    }

    let resizeTimer: number | undefined;
    function onResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, RESIZE_DEBOUNCE_MS);
    }
    function onMouseMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    }
    function onMouseLeave() {
      mouseRef.current = null;
    }

    function frame() {
      rafRef.current = requestAnimationFrame(frame);
      const { w, h } = sizeRef.current;
      const cols = colsRef.current;
      const rows = rowsRef.current;
      const dots = dotsRef.current;
      const mouse = mouseRef.current;
      const { intensity: currentIntensity, radius: currentRadius } = propsRef.current;
      const { r, g, b, a: baseOpacity } = dotColorRef.current;

      if (mouse) {
        const minCol = Math.max(0, Math.floor((mouse.x - currentRadius) / GRID));
        const maxCol = Math.min(cols - 1, Math.ceil((mouse.x + currentRadius) / GRID));
        const minRow = Math.max(0, Math.floor((mouse.y - currentRadius) / GRID));
        const maxRow = Math.min(rows - 1, Math.ceil((mouse.y + currentRadius) / GRID));
        for (let row = minRow; row <= maxRow; row++) {
          for (let col = minCol; col <= maxCol; col++) {
            activeRef.current.add(row * cols + col);
          }
        }
      }

      // Only dots near the cursor, or still springing back from a recent pass,
      // pay for the distance/easing math each frame — everything else keeps
      // its cached (usually resting) radius/opacity from the last time it was active.
      for (const index of activeRef.current) {
        const dot = dots[index];
        if (!dot) {
          activeRef.current.delete(index);
          continue;
        }

        let targetDX = 0;
        let targetDY = 0;
        let f = 0;

        if (mouse) {
          const dx = dot.homeX - mouse.x;
          const dy = dot.homeY - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < currentRadius && dist > 0.001) {
            const t = 1 - dist / currentRadius;
            const eased = t * t;
            f = Math.min(1, eased * currentIntensity);
            const mag = DISPLACEMENT * currentIntensity * eased;
            targetDX = (dx / dist) * mag;
            targetDY = (dy / dist) * mag;
          }
        }

        const springDX = targetDX - dot.offsetX;
        const springDY = targetDY - dot.offsetY;
        dot.velX = (dot.velX + springDX * STIFFNESS) * DAMPING;
        dot.velY = (dot.velY + springDY * STIFFNESS) * DAMPING;
        dot.offsetX += dot.velX;
        dot.offsetY += dot.velY;
        dot.radius = BASE_RADIUS * (1 + (MAX_RADIUS_MULT - 1) * f);
        dot.opacity = baseOpacity + (MAX_OPACITY - baseOpacity) * f;

        if (
          f === 0 &&
          Math.abs(dot.offsetX) < SETTLE_EPSILON &&
          Math.abs(dot.offsetY) < SETTLE_EPSILON &&
          Math.abs(dot.velX) < SETTLE_EPSILON &&
          Math.abs(dot.velY) < SETTLE_EPSILON
        ) {
          dot.offsetX = 0;
          dot.offsetY = 0;
          dot.velX = 0;
          dot.velY = 0;
          dot.radius = BASE_RADIUS;
          dot.opacity = baseOpacity;
          activeRef.current.delete(index);
        }
      }

      ctx!.clearRect(0, 0, w, h);
      for (const dot of dots) {
        ctx!.beginPath();
        ctx!.fillStyle = `rgba(${r},${g},${b},${dot.opacity})`;
        ctx!.arc(dot.homeX + dot.offsetX, dot.homeY + dot.offsetY, dot.radius, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function stop() {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
    function resume() {
      if (!reducedMotion && rafRef.current === null && document.visibilityState === 'visible') {
        rafRef.current = requestAnimationFrame(frame);
      }
    }
    function onVisibilityChange() {
      if (document.hidden) stop();
      else resume();
    }

    resize();
    window.addEventListener('resize', onResize);

    if (!reducedMotion) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseleave', onMouseLeave);
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('focus', resume);
      rafRef.current = requestAnimationFrame(frame);
    }

    return () => {
      stop();
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', resume);
    };
  }, []);

  return (
    <div className={styles.root} aria-hidden>
      <div className={styles.mesh} style={{ '--intensity': intensity } as React.CSSProperties}>
        <span className={`${styles.blob} ${styles.blob1}`} />
        <span className={`${styles.blob} ${styles.blob2}`} />
        <span className={`${styles.blob} ${styles.blob3}`} />
        <span className={`${styles.blob} ${styles.blob4}`} />
      </div>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
