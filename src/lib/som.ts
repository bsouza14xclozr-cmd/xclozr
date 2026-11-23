// Som de venda ("cha-ching") gerado no próprio navegador (sem arquivo de áudio)

const CHAVE = "xclozr:som-venda";
let ctx: AudioContext | null = null;

function contexto() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  return ctx;
}

/** iPhone/Chrome só deixam tocar som depois de um toque na tela: destrava no primeiro toque. */
export function destravarSom() {
  if (typeof window === "undefined") return;
  const destravar = () => {
    const c = contexto();
    if (c && c.state === "suspended") void c.resume();
  };
  window.addEventListener("pointerdown", destravar, { once: true, passive: true });
  window.addEventListener("keydown", destravar, { once: true });
}

export function somLigado() {
  try {
    return window.localStorage.getItem(CHAVE) !== "0";
  } catch {
    return true;
  }
}
export function ligarSom(sim: boolean) {
  try {
    window.localStorage.setItem(CHAVE, sim ? "1" : "0");
  } catch {
    /* sem armazenamento */
  }
}

function tom(c: AudioContext, freq: number, ini: number, dur: number, vol: number, tipo: OscillatorType = "triangle") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = tipo;
  o.frequency.setValueAtTime(freq, ini);
  g.gain.setValueAtTime(0.0001, ini);
  g.gain.exponentialRampToValueAtTime(vol, ini + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, ini + dur);
  o.connect(g).connect(c.destination);
  o.start(ini);
  o.stop(ini + dur + 0.02);
}

function estalo(c: AudioContext, ini: number, dur: number, vol: number) {
  // "ká" metálico da gaveta do caixa: ruído curto filtrado
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 3200;
  f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start(ini);
}

/** Toca o "cha-ching" (venda) ou um "plim" curto (lead). */
export function tocarSom(tipo: "venda" | "lead" = "venda", forcar = false) {
  if (!forcar && !somLigado()) return;
  const c = contexto();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const t = c.currentTime + 0.02;
  if (tipo === "lead") {
    tom(c, 880, t, 0.18, 0.18, "sine");
    tom(c, 1320, t + 0.09, 0.25, 0.14, "sine");
    return;
  }
  // cha-ching: estalo da gaveta + moedas (duas notas brilhantes com harmônicos)
  estalo(c, t, 0.07, 0.5);
  tom(c, 1568, t + 0.05, 0.12, 0.22);
  tom(c, 3136, t + 0.05, 0.1, 0.06, "sine");
  estalo(c, t + 0.16, 0.05, 0.35);
  tom(c, 2093, t + 0.2, 0.55, 0.26);
  tom(c, 4186, t + 0.2, 0.4, 0.08, "sine");
  tom(c, 2637, t + 0.24, 0.5, 0.12);
}
