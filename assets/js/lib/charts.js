// Gráficos (Chart.js cargado bajo demanda).
let ChartMod = null;
async function cargar() {
  if (!ChartMod) {
    ChartMod = await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.7/+esm');
    ChartMod.Chart.register(...ChartMod.registerables);
  }
  return ChartMod.Chart;
}

export const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const colores = () => ({
  accent: css('--accent'), ok: css('--ok'), bad: css('--bad'), warn: css('--warn'), info: css('--info'),
  text: css('--text-2'), grid: css('--border'), faint: css('--text-3'),
});

const instancias = new WeakMap();

export async function grafico(canvas, config) {
  if (!canvas) return null;
  const Chart = await cargar();
  instancias.get(canvas)?.destroy();
  const c = colores();
  Chart.defaults.color = c.text;
  Chart.defaults.font.family = css('--font');
  Chart.defaults.borderColor = c.grid;
  const base = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } }, tooltip: { padding: 10 } },
  };
  const ch = new Chart(canvas, { ...config, options: deepMerge(base, config.options || {}) });
  instancias.set(canvas, ch);
  return ch;
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object'
      ? deepMerge(a[k], b[k]) : b[k];
  }
  return out;
}

export function mediaMovil(valores, ventana = 7) {
  return valores.map((_, i) => {
    const tramo = valores.slice(Math.max(0, i - ventana + 1), i + 1).filter((v) => v !== null && v !== undefined);
    return tramo.length ? Math.round((tramo.reduce((s, v) => s + v, 0) / tramo.length) * 10) / 10 : null;
  });
}

export const ejePct = { min: 0, max: 100, ticks: { callback: (v) => v + '%' } };
