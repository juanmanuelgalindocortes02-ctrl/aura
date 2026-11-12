// Isla dinámica: píldora negra arriba al centro que muestra lo que suena.
// Se estira al pasar el mouse (o al cambiar de canción) y enseña controles y la línea de la letra.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { colorDePortada } from "./efectos.js";

const $ = (id) => document.getElementById(id);
let base = { pos: 0, at: 0, playing: false, dur: 0 };
let expandida = false;
let cierre = 0;
let claveAnterior = "";
const barras = [...document.querySelectorAll(".eq i")];
const meta = [0, 0, 0, 0];
const altura = [0, 0, 0, 0];

listen("media://state", (e) => pintar(e.payload));
listen("aura://linea", (e) => texto("i-linea", e.payload || ""));
listen("audio://bands", (e) => {
  const s = e.payload.spectrum;
  [2, 8, 16, 26].forEach((k, i) => { meta[i] = s[k] ?? 0; });
  document.body.style.setProperty("--bajo", e.payload.bass.toFixed(3));
});

function pintar(s) {
  const n = s.now;
  document.body.classList.toggle("sonando", !!n?.playing);
  texto("i-titulo", n ? n.title || "Sin título" : "Sin música");
  texto("i-artista", n?.artist ?? "");
  const img = $("i-portada");
  if (n?.cover) {
    if (img.getAttribute("src") !== n.cover) img.src = n.cover;
    img.hidden = false;
    colorDePortada(n.cover);
  } else {
    img.hidden = true;
  }
  ["i-prev", "i-play", "i-next"].forEach((id) => { $(id).disabled = !n; });
  if (n) {
    $("i-prev").disabled = !n.canPrev;
    $("i-next").disabled = !n.canNext;
    $("i-play").setAttribute("aria-label", n.playing ? "Pausar" : "Reproducir");
    base = { pos: n.positionMs, at: performance.now(), playing: n.playing, dur: n.durationMs };
    texto("i-total", fmt(n.durationMs));
    // Canción nueva: la isla se asoma unos segundos, como en el iPhone.
    const clave = `${n.artist}|${n.title}`;
    if (clave !== claveAnterior) {
      if (claveAnterior) asomarse();
      claveAnterior = clave;
      texto("i-linea", "");
    }
  }
}

function asomarse() {
  expandir(true);
  clearTimeout(cierre);
  cierre = setTimeout(() => { if (!$("isla").matches(":hover")) expandir(false); }, 3500);
}

function expandir(si) {
  if (si === expandida) return;
  expandida = si;
  if (si) {
    // Primero se agranda la ventana y luego se anima la píldora.
    invoke("isla_tamano", { expandida: true }).finally(() => document.body.classList.add("expandida"));
  } else {
    document.body.classList.remove("expandida");
    setTimeout(() => { if (!expandida) invoke("isla_tamano", { expandida: false }); }, 360);
  }
}

$("isla").addEventListener("mouseenter", () => { clearTimeout(cierre); expandir(true); });
$("isla").addEventListener("mouseleave", () => {
  clearTimeout(cierre);
  cierre = setTimeout(() => expandir(false), 500);
});

const control = (action) => invoke("media_control", { action });
$("i-play").addEventListener("click", () => control("toggle"));
$("i-next").addEventListener("click", () => control("next"));
$("i-prev").addEventListener("click", () => control("prev"));

function animar() {
  // Ecualizador con el audio real.
  for (let i = 0; i < 4; i++) {
    altura[i] += (meta[i] - altura[i]) * 0.3;
    barras[i].style.height = `${4 + altura[i] * 16}px`;
  }
  if (base.dur > 0) {
    const pos = Math.min(base.playing ? base.pos + (performance.now() - base.at) : base.pos, base.dur);
    $("i-avance").style.width = `${(pos / base.dur) * 100}%`;
    texto("i-actual", fmt(pos));
  }
  requestAnimationFrame(animar);
}
requestAnimationFrame(animar);

function texto(id, v) {
  const el = $(id);
  if (el.textContent !== v) el.textContent = v;
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
