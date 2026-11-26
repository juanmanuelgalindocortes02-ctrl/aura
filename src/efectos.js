// Efectos neón al ritmo: cintas de luz, barras del espectro, partículas, bordes que laten
// con cada golpe y glitch en los drops. Todo se dibuja en la GPU con un shader WebGL.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const MODOS = ["completo", "ligero", "apagado"];
const NOMBRES = { completo: "Efectos: completos", ligero: "Efectos: modo ligero", apagado: "Efectos: apagados" };
const poquitoMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;

let modo = localStorage.getItem("aura.efectos") ?? (poquitoMovimiento ? "apagado" : "completo");

// Lo último que mandó Rust y la versión suavizada que se dibuja.
const audio = { bass: 0, mid: 0, high: 0, spectrum: new Float32Array(32) };
const suave = { bass: 0, mid: 0, high: 0, spectrum: new Float32Array(32) };
let pulso = 0;

// Escenas: cada una es un diseño distinto; la línea del borde, la onda y las partículas van en todas.
const ESCENAS = ["cintas", "synthwave", "laser", "anillo"];
const NOMBRES_ESCENA = { cintas: "Cintas de neón", synthwave: "Synthwave", laser: "Láser", anillo: "Anillo" };
let escena = localStorage.getItem("aura.escena") ?? "cintas";
if (!ESCENAS.includes(escena)) escena = "cintas";
let giro = 0;    // posición de las líneas del borde y de los aros (0..1)
let avance = 0;  // avance del piso synthwave
let onda = 10;   // segundos desde el último golpe
let foco = [0.9, 0.5, 0.2];      // centro y radio de la portada en coordenadas del shader
const metaFoco = [0.9, 0.5, 0.2];
let cuadros = 0;
let tAnterior = 0;

// Colores neón (0..1). Se toman de la portada y cambian suave entre canciones.
const colorA = [1, 0.31, 0.64];
const colorB = [0.55, 0.36, 0.96];
const metaA = [...colorA];
const metaB = [...colorB];

const VERTICES = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAGMENTOS = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uPulse;
uniform float uLite;
uniform float uEscena;
uniform float uGiro;
uniform float uAvance;
uniform float uOnda;
uniform vec3 uFoco;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uSpec[32];

const float PI = 3.14159265;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Una cinta de luz ondulada: núcleo brillante y halo suave alrededor.
float cinta(vec2 uv, float y0, float freq, float vel, float amp, float fase) {
  float y = y0 + sin(uv.x * freq + uTime * vel + fase) * amp
               + sin(uv.x * freq * 2.3 - uTime * vel * 0.7 + fase * 1.7) * amp * 0.35;
  float d = abs(uv.y - y);
  return 0.004 / (d + 0.004) + 0.25 * exp(-d * 12.0);
}

// Un rayo láser que sale de "o" con ángulo "a" y se apaga con la distancia.
float rayo(vec2 uv, vec2 o, float a) {
  vec2 dir = vec2(cos(a), sin(a));
  vec2 q = uv - o;
  float largo = dot(q, dir);
  if (largo < 0.0) return 0.0;
  float d = abs(q.x * dir.y - q.y * dir.x);
  return (0.0015 / (d + 0.0015) + 0.15 * exp(-d * 40.0)) * exp(-largo * 0.6);
}

float espectro(float i) {
  float v = 0.0;
  for (int k = 0; k < 32; k++) {
    if (float(k) == i) v = uSpec[k];
  }
  return v;
}

void main() {
  vec2 p = gl_FragCoord.xy / uRes;
  float ancho = uRes.x / uRes.y;
  vec2 uv = vec2(p.x * ancho, p.y);
  vec3 col = vec3(0.0);
  vec3 colM = mix(uColA, uColB, 0.5);

  if (uEscena < 0.5) {
    // ---- Cintas de neón + barras del espectro ----
    float amp = 0.02 + uBass * 0.06;
    col += uColA * cinta(uv, 0.20, 2.2, 0.6, amp, 0.0) * (0.35 + 0.65 * uBass) * 0.55;
    col += uColB * cinta(uv, 0.27, 3.1, -0.45, amp * 0.8, 2.0) * (0.3 + 0.7 * uMid) * 0.45;
    col += colM * cinta(uv, 0.88, 1.6, 0.35, amp * 0.6, 4.0) * (0.3 + 0.7 * uHigh) * 0.3;

    float x = abs(p.x - 0.5) * 2.0;
    float v = espectro(min(floor(x * 32.0), 31.0));
    float alto = v * 0.16;
    float hueco = step(0.18, fract(x * 32.0));
    float cuerpo = step(p.y, alto) * hueco;
    float halo = (1.0 - smoothstep(alto, alto + 0.04, p.y)) * hueco * 0.35;
    col += mix(uColA, uColB, x) * (cuerpo * 0.55 + halo) * step(0.001, v);
  } else if (uEscena < 1.5) {
    // ---- Synthwave: piso de cuadrícula que avanza y sol a rayas ----
    float hor = 0.40;
    if (p.y < hor) {
      float yy = hor - p.y;
      float zz = 0.12 / yy;
      float xx = (uv.x - ancho * 0.5) * zz * 3.0;
      float gx = 0.5 - abs(fract(xx) - 0.5);
      float gz = 0.5 - abs(fract(zz - uAvance) - 0.5);
      float w = clamp(0.02 * zz, 0.02, 0.45);
      float lin = max(1.0 - smoothstep(0.0, w, gx), 1.0 - smoothstep(0.0, w, gz));
      col += uColB * lin * smoothstep(0.0, 0.12, yy) * (0.45 + 0.55 * uBass);
    }
    col += uColA * exp(-abs(p.y - hor) * 30.0) * (0.4 + 0.6 * uBass);
    vec2 cs = vec2(clamp(uFoco.x, 0.25, ancho - 0.25), hor + 0.14); // detrás de la portada, no del texto
    float rs = 0.15 + uBass * 0.02;
    float ds = length(uv - cs);
    float franja = step(0.45, fract((uv.y - hor) * 28.0 + uTime * 0.6));
    float bandas = uv.y > cs.y ? 1.0 : franja;
    float arriba = step(hor, p.y);
    float sol = (1.0 - smoothstep(rs - 0.004, rs, ds)) * bandas * arriba;
    col += mix(uColA, vec3(1.0, 0.85, 0.4), clamp((uv.y - hor) / 0.3, 0.0, 1.0)) * sol * 0.55;
    col += uColA * exp(-max(ds - rs, 0.0) * 9.0) * 0.18 * arriba;
  } else if (uEscena < 2.5) {
    // ---- Láser de concierto desde las esquinas ----
    float fuerza = 0.25 + 0.5 * uMid + 0.6 * uPulse;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float vaiven = sin(uTime * (0.7 + fi * 0.23) + fi * 2.1) * 0.35;
      float aL = 0.95 + fi * 0.22 + vaiven;
      vec3 c1 = mod(fi, 2.0) < 0.5 ? uColA : uColB;
      vec3 c2 = mod(fi, 2.0) < 0.5 ? uColB : uColA;
      col += c1 * rayo(uv, vec2(0.0, 0.0), aL) * fuerza * 0.5;
      col += c2 * rayo(uv, vec2(ancho, 0.0), PI - aL) * fuerza * 0.5;
    }
    col += colM * rayo(uv, vec2(ancho * 0.5, 0.0), PI * 0.5 + sin(uTime * 1.3) * 0.5) * (0.15 + uPulse * 0.7) * 0.6;
    col += colM * exp(-p.y * 6.0) * 0.08 * (0.5 + uBass);
  } else {
    // ---- Anillo: espectro circular alrededor de la portada y aros que giran ----
    vec2 q = uv - uFoco.xy;
    float r = length(q);
    float ang = atan(q.y, q.x);
    float base = uFoco.z + 0.02;
    float t = abs(ang) / PI;
    float v = espectro(min(floor(t * 32.0), 31.0));
    float largo = 0.01 + v * 0.14;
    float hueco = step(0.25, fract(t * 32.0));
    float barra = step(base, r) * (1.0 - smoothstep(base + largo, base + largo + 0.006, r)) * hueco;
    col += mix(uColA, uColB, t) * barra * 0.6;
    col += mix(uColA, uColB, t) * exp(-abs(r - base - largo) * 60.0) * hueco * v * 0.4;
    float aro = exp(-abs(r - (base - 0.012)) * 400.0);
    float guiones = step(0.5, fract(ang / (2.0 * PI) * 36.0 + uGiro * 6.0));
    col += uColA * aro * guiones * (0.4 + 0.6 * uBass);
    float aro2 = exp(-abs(r - (base + 0.17)) * 300.0);
    float guiones2 = step(0.7, fract(ang / (2.0 * PI) * 12.0 - uGiro * 3.0));
    col += uColB * aro2 * guiones2 * (0.25 + 0.6 * uHigh);
  }

  // Partículas que suben más rápido con los agudos (no en modo ligero).
  if (uLite < 0.5) {
    vec2 g = uv * 16.0;
    g.y -= uTime * (0.4 + uHigh * 1.6);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float rnd = hash(id);
    if (rnd > 0.86) {
      vec2 o = vec2(hash(id + 1.3), hash(id + 2.7)) - 0.5;
      float d = length(f - o * 0.6);
      col += mix(uColA, uColB, hash(id + 5.1)) * (1.0 - smoothstep(0.0, 0.09, d)) * (0.25 + uHigh * 1.2);
    }
  }

  // Onda expansiva que sale de la portada con cada golpe.
  float dOnda = abs(length(uv - uFoco.xy) - (uFoco.z + uOnda * 0.9));
  col += colM * (0.003 / (dOnda + 0.003)) * exp(-uOnda * 3.5) * 0.6;

  // Dos líneas de luz que recorren el borde de la pantalla, más rápido con los graves.
  float m = 0.0015; // pegada al borde
  float dB = abs(uv.y - m);
  float dT = abs(1.0 - m - uv.y);
  float dL = abs(uv.x - m);
  float dR = abs(ancho - m - uv.x);
  float dBorde = min(min(dB, dT), min(dL, dR));
  float L = 2.0 * (ancho + 1.0);
  float s;
  if (dB == dBorde) s = uv.x;
  else if (dR == dBorde) s = ancho + uv.y;
  else if (dT == dBorde) s = ancho + 1.0 + (ancho - uv.x);
  else s = 2.0 * ancho + 1.0 + (1.0 - uv.y);
  float linea = 0.0025 / (dBorde + 0.0025);
  float cabeza = uGiro * L;
  float brillo = 0.6 + 0.8 * uBass;
  col += uColA * linea * exp(-mod(cabeza - s, L) * 2.2) * brillo;
  col += uColB * linea * exp(-mod(cabeza + L * 0.5 - s, L) * 2.2) * brillo;

  // Bordes que se encienden con cada golpe.
  float borde = pow(max(abs(p.x - 0.5), abs(p.y - 0.5)) * 2.0, 5.0);
  col += uColA * borde * uPulse * 0.6;

  gl_FragColor = vec4(col, 1.0);
}`;

let canvas, gl, prog, u = {};
let rafId = 0;
let ultimoCuadro = 0;
const inicio = performance.now();

export function iniciarEfectos() {
  canvas = document.getElementById("neon");
  gl = crearGL(canvas);
  window.addEventListener("resize", ajustarTamano);

  listen("audio://bands", (e) => {
    const d = e.payload;
    audio.bass = d.bass;
    audio.mid = d.mid;
    audio.high = d.high;
    audio.spectrum.set(d.spectrum);
    if (d.beat) { pulso = 1; onda = 0; }
    if (d.drop) glitch();
  });

  aplicarModo();
}

/** Cambiar escena o modo desde fuera (lo usa la IA). */
export function ponerEscena(nombre) {
  if (!ESCENAS.includes(nombre)) return;
  escena = nombre;
  localStorage.setItem("aura.escena", escena);
  avisar(NOMBRES_ESCENA[escena]);
}

export const obtenerEscena = () => escena;
export const obtenerModo = () => modo;

export function ponerModoEfectos(m) {
  if (!MODOS.includes(m)) return;
  modo = m;
  localStorage.setItem("aura.efectos", modo);
  aplicarModo();
}

let avisoTimer = 0;
export function avisar(textoAviso) {
  const el = document.getElementById("aviso");
  el.textContent = textoAviso;
  el.classList.add("visible");
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => el.classList.remove("visible"), 1400);
}

/** Dónde está la portada en pantalla, para centrar el anillo y las ondas. */
function medirFoco() {
  const actual = document.getElementById("actual");
  const el = document.querySelector("body.con-carrusel .tarjeta.centro")
    ?? (!actual.hidden && !document.body.classList.contains("con-carrusel") ? actual.querySelector(".portada-marco") : null);
  let cx = innerWidth / 2, cy = innerHeight / 2, r = innerHeight * 0.15;
  if (el) {
    const b = el.getBoundingClientRect();
    if (b.width > 0) { cx = b.left + b.width / 2; cy = b.top + b.height / 2; r = (b.width / 2) * 1.45; }
  }
  metaFoco[0] = cx / innerHeight;
  metaFoco[1] = 1 - cy / innerHeight;
  metaFoco[2] = r / innerHeight;
}

let pausado = false;

/** Pausa todo cuando algo tapa el escritorio (un juego, una ventana maximizada). */
export function pausarEfectos(si) {
  pausado = si;
  aplicarModo();
}

function aplicarModo() {
  canvas.hidden = modo === "apagado" || !gl;
  invoke("set_visualizer", { on: modo !== "apagado" && !pausado }).catch(() => {});
  cancelAnimationFrame(rafId);
  if (modo === "apagado" || pausado) {
    document.body.style.setProperty("--bajo", "0");
    return;
  }
  ajustarTamano();
  rafId = requestAnimationFrame(cuadro);
}

function ajustarTamano() {
  if (!gl) return;
  // El brillo es suave, así que se dibuja a menor resolución y casi no se nota (y va más fluido).
  const escala = modo === "ligero" ? 0.4 : 0.65;
  canvas.width = Math.max(1, Math.round(innerWidth * escala));
  canvas.height = Math.max(1, Math.round(innerHeight * escala));
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function cuadro(t) {
  rafId = requestAnimationFrame(cuadro);
  if (modo === "ligero" && t - ultimoCuadro < 32) return; // ~30 FPS
  ultimoCuadro = t;
  const dt = Math.min(0.1, (t - (tAnterior || t)) / 1000);
  tAnterior = t;

  // Rust manda 50 datos por segundo; aquí se suavizan para que se vea fluido a 60.
  for (const k of ["bass", "mid", "high"]) suave[k] += (audio[k] - suave[k]) * 0.35;
  for (let i = 0; i < 32; i++) suave.spectrum[i] += (audio.spectrum[i] - suave.spectrum[i]) * 0.35;
  pulso *= 0.88;
  giro = (giro + dt * (0.05 + suave.bass * 0.3)) % 1;
  avance = (avance + dt * (0.5 + suave.bass * 2.0)) % 1000;
  onda += dt;
  if (cuadros++ % 6 === 0) medirFoco();
  for (let i = 0; i < 3; i++) foco[i] += (metaFoco[i] - foco[i]) * 0.2;
  for (let i = 0; i < 3; i++) {
    colorA[i] += (metaA[i] - colorA[i]) * 0.04;
    colorB[i] += (metaB[i] - colorB[i]) * 0.04;
  }

  const raiz = document.body.style;
  raiz.setProperty("--bajo", suave.bass.toFixed(3));
  raiz.setProperty("--pulso", pulso.toFixed(3));

  if (!gl) return;
  gl.useProgram(prog);
  gl.uniform2f(u.uRes, canvas.width, canvas.height);
  gl.uniform1f(u.uTime, (t - inicio) / 1000);
  gl.uniform1f(u.uBass, suave.bass);
  gl.uniform1f(u.uMid, suave.mid);
  gl.uniform1f(u.uHigh, suave.high);
  gl.uniform1f(u.uPulse, pulso);
  gl.uniform1f(u.uLite, modo === "ligero" ? 1 : 0);
  gl.uniform1f(u.uEscena, ESCENAS.indexOf(escena));
  gl.uniform1f(u.uGiro, giro);
  gl.uniform1f(u.uAvance, avance);
  gl.uniform1f(u.uOnda, onda);
  gl.uniform3fv(u.uFoco, foco);
  gl.uniform3fv(u.uColA, colorA);
  gl.uniform3fv(u.uColB, colorB);
  gl.uniform1fv(u.uSpec, suave.spectrum);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function crearGL(c) {
  const g = c.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
  if (!g) {
    console.warn("WebGL no disponible: solo se usarán los efectos ligeros de la interfaz.");
    return null;
  }
  const compilar = (tipo, codigo) => {
    const s = g.createShader(tipo);
    g.shaderSource(s, codigo);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s));
    return s;
  };
  try {
    prog = g.createProgram();
    g.attachShader(prog, compilar(g.VERTEX_SHADER, VERTICES));
    g.attachShader(prog, compilar(g.FRAGMENT_SHADER, FRAGMENTOS));
    g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog));
  } catch (e) {
    console.error("Error en el shader de efectos:", e);
    return null;
  }
  // Un triángulo que cubre toda la pantalla.
  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
  const a = g.getAttribLocation(prog, "a");
  g.enableVertexAttribArray(a);
  g.vertexAttribPointer(a, 2, g.FLOAT, false, 0, 0);
  for (const n of ["uRes", "uTime", "uBass", "uMid", "uHigh", "uPulse", "uLite", "uEscena", "uGiro", "uAvance", "uOnda", "uFoco", "uColA", "uColB", "uSpec"]) {
    u[n] = g.getUniformLocation(prog, n);
  }
  return g;
}

function glitch() {
  if (modo === "apagado" || poquitoMovimiento) return;
  const b = document.body;
  b.classList.remove("glitch");
  void b.offsetWidth; // reinicia la animación
  b.classList.add("glitch");
  setTimeout(() => b.classList.remove("glitch"), 240);
}

// ---------- Colores de la portada ----------

let ultimaPortada = null;

/** Saca dos colores vivos de la portada y los vuelve neón. */
export function colorDePortada(src) {
  if (!src || src === ultimaPortada) return;
  ultimaPortada = src;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 24;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 24, 24);
      const px = ctx.getImageData(0, 0, 24, 24).data;
      const candidatos = [];
      for (let i = 0; i < px.length; i += 4) {
        const [h, s, l] = aHsl(px[i], px[i + 1], px[i + 2]);
        candidatos.push({ h, s, puntos: s * (1 - Math.abs(l - 0.55) * 1.4) });
      }
      candidatos.sort((a, b) => b.puntos - a.puntos);
      const primero = candidatos[0];
      const distinto = (a, b) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b)) > 0.12;
      const segundo = candidatos.find((c) => c.puntos > 0.15 && distinto(c.h, primero.h));
      // Portada sin color (blanco y negro): se queda el rosa y violeta de siempre.
      if (primero.puntos < 0.12) return usarColores([1, 0.31, 0.64], [0.55, 0.36, 0.96]);
      const hA = primero.h;
      const hB = segundo ? segundo.h : (hA + 0.14) % 1;
      usarColores(aRgb(hA, 0.9, 0.6), aRgb(hB, 0.9, 0.6));
    } catch {
      // La imagen no deja leer sus pixeles: se mantienen los colores actuales.
    }
  };
  img.src = src;
}

// Color elegido en el menú; null = tomarlo de cada portada.
let acentoFijo = null;
let colorPortada = [[1, 0.31, 0.64], [0.55, 0.36, 0.96]];

/** hex como "#38bdf8", o null para volver a los colores de la portada. */
export function fijarAcento(hex) {
  if (!hex) {
    acentoFijo = null;
    return pintarColores(...colorPortada);
  }
  const n = parseInt(hex.slice(1), 16);
  const a = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const [h] = aHsl(a[0] * 255, a[1] * 255, a[2] * 255);
  acentoFijo = [a, aRgb((h + 0.14) % 1, 0.85, 0.6)];
  pintarColores(...acentoFijo);
}

function usarColores(a, b) {
  colorPortada = [a, b];
  if (!acentoFijo) pintarColores(a, b);
}

function pintarColores(a, b) {
  metaA.splice(0, 3, ...a);
  metaB.splice(0, 3, ...b);
  const rgb = a.map((v) => Math.round(v * 255)).join(", ");
  document.documentElement.style.setProperty("--c1rgb", rgb);
  document.documentElement.style.setProperty("--acento", `rgb(${rgb})`);
}

function aHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function aRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
