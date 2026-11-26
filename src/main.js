import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { iniciarEfectos, colorDePortada, pausarEfectos, ponerEscena, ponerModoEfectos, avisar } from "./efectos.js";
import { iniciarChat } from "./chat.js";
import { Constelacion } from "./constelacion.js";
import { Mensajes } from "./mensajes.js";
import { iniciarAjustes } from "./ajustes.js";

const $ = (id) => document.getElementById(id);

// Color e inicial de cada tipo de app (en la versión final irán sus íconos).
const APPS = {
  spotify: { color: "#1db954", tinta: "#08130c" },
  apple: { color: "#fa2d48", tinta: "#ffffff" },
  amazon: { color: "#25d1da", tinta: "#04191a" },
  web: { color: "#8b5cf6", tinta: "#ffffff" },
  windows: { color: "#38bdf8", tinta: "#04121a" },
  other: { color: "#475569", tinta: "#ffffff" },
};

let estado = null;
let base = { pos: 0, at: 0, playing: false, dur: 0 };
let arrastrando = false;
let firmaFuentes = "";
// Portadas que no cargaron: se muestra el ícono de nota en vez de un cuadro vacío.
const portadasRotas = new Set();
$("portada").addEventListener("error", () => {
  const src = $("portada").getAttribute("src");
  if (!src) return;
  portadasRotas.add(src);
  $("portada").hidden = true;
  $("portada-vacia").hidden = false;
  $("actual").classList.add("sin-portada");
});
let letra = { clave: "", lineas: [], plano: null, activa: -1 };
const ESTILOS_LETRA = ["lista", "constelacion", "mensajes"];
const NOMBRE_ESTILO = { lista: "lista", constelacion: "constelación", mensajes: "mensajes" };
let mostrarLetra = localStorage.getItem("aura.mostrarLetra") !== "no";
let estiloLetra = ESTILOS_LETRA.includes(localStorage.getItem("aura.estiloLetra")) ? localStorage.getItem("aura.estiloLetra") : "lista";
const constel = new Constelacion($("constelacion"));
const msj = new Mensajes($("mensajes"));
let avisoSinTiempos = "";

listen("media://state", (e) => pintar(e.payload));
iniciarEfectos();

// Modo fondo de pantalla: sin barra ni cursor; se pausa si un juego o ventana tapa el escritorio.
const ponerModoFondo = (si) => document.body.classList.toggle("fondo", si);
invoke("wallpaper_mode").then(ponerModoFondo).catch(() => {});
listen("fondo://modo", (e) => ponerModoFondo(e.payload));
listen("fondo://tapado", (e) => pausarEfectos(e.payload));

function pintar(s) {
  estado = s;
  const n = s.now;
  $("vacio").hidden = !!n;
  if (n) registrarCancion(n);
  $("actual").hidden = !n;
  document.body.classList.toggle("sonando", !!n?.playing);

  if (n) {
    texto("titulo", n.title || "Sin título");
    texto("artista", n.artist);
    texto("album", n.album);
    const cover = n.cover && !portadasRotas.has(n.cover) ? n.cover : null;
    $("actual").classList.toggle("sin-portada", !cover);
    imagen($("portada"), cover);
    $("portada-vacia").hidden = !!cover;
    imagen($("fondo-img"), cover);
    colorDePortada(cover);
    $("btn-play").setAttribute("aria-label", n.playing ? "Pausar" : "Reproducir");
    $("btn-prev").disabled = !n.canPrev;
    $("btn-next").disabled = !n.canNext;
    if (!arrastrando) base = { pos: n.positionMs, at: performance.now(), playing: n.playing, dur: n.durationMs };
    texto("t-total", n.durationMs ? fmt(n.durationMs) : "");
    const clave = `${n.artist}|${n.title}`;
    if (clave !== letra.clave && n.durationMs > 0) cargarLetra(n, clave);
  } else {
    imagen($("fondo-img"), null);
    base = { pos: 0, at: 0, playing: false, dur: 0 };
    if (letra.clave) { letra = { clave: "", lineas: [], plano: null, activa: -1 }; pintarLetra(); }
  }
  ["btn-play", "btn-prev", "btn-next"].forEach((id) => { if (!n) $(id).disabled = true; });
  if (n) $("btn-play").disabled = false;
  $("barra-tiempo").disabled = !n?.canSeek;

  pintarFuente(s);
}

function pintarFuente(s) {
  const n = s.now;
  const app = APPS[n?.sourceKind] ?? APPS.other;
  const icono = $("fuente-icono");
  icono.textContent = n ? n.sourceName[0] : "?";
  icono.style.background = app.color;
  icono.style.color = app.tinta;
  const nombre = n ? n.sourceName : "Sin app";
  texto("fuente-nombre", s.selected === "auto" && n ? `Auto: ${nombre}` : nombre);
  $("btn-fuente").setAttribute("aria-label", `App conectada: ${nombre}. Cambiar`);

  // El menú solo se reconstruye si cambió algo, para no perder el foco ni el hover.
  const firma = JSON.stringify([s.selected, s.sources]);
  if (firma !== firmaFuentes) {
    firmaFuentes = firma;
    pintarMenu(s);
  }
}

function pintarMenu(s) {
  const lista = $("lista-fuentes");
  lista.replaceChildren();
  if (!s.sources.length) {
    const p = document.createElement("p");
    p.className = "menu-titulo";
    p.textContent = "No hay apps de música abiertas.";
    lista.append(p);
  }
  for (const f of s.sources) {
    lista.append(opcion(f.id, f.name, f.status, f.kind, s.selected === f.id, f.status === "Sonando ahora"));
  }
  const sep = document.createElement("div");
  sep.className = "separador";
  lista.append(sep, opcion("auto", "Automático", "Sigue a la app que esté sonando", null, s.selected === "auto", false));
}

function opcion(id, nombre, estadoTxt, kind, marcada, vivo) {
  const b = document.createElement("button");
  b.className = "opcion";
  b.setAttribute("role", "menuitemradio");
  b.setAttribute("aria-checked", String(marcada));
  const app = APPS[kind] ?? APPS.other;
  b.innerHTML = `
    ${kind
      ? `<span class="icono-app" style="background:${app.color};color:${app.tinta}"></span>`
      : `<span class="icono-app" style="background:transparent"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg></span>`}
    <span class="opcion-texto"><span class="opcion-nombre"></span><span class="opcion-estado${vivo ? " vivo" : ""}"></span></span>
    <svg class="check" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  if (kind) b.querySelector(".icono-app").textContent = nombre[0];
  b.querySelector(".opcion-nombre").textContent = nombre;
  b.querySelector(".opcion-estado").textContent = estadoTxt;
  b.addEventListener("click", () => {
    invoke("select_source", { id });
    cerrarMenu();
  });
  return b;
}

// Menú de fuentes
const menu = $("menu-fuente");
const btnFuente = $("btn-fuente");
function abrirMenu() { menu.hidden = false; btnFuente.setAttribute("aria-expanded", "true"); }
function cerrarMenu() { menu.hidden = true; btnFuente.setAttribute("aria-expanded", "false"); }
btnFuente.addEventListener("click", (e) => {
  e.stopPropagation();
  menu.hidden ? abrirMenu() : cerrarMenu();
});
document.addEventListener("click", (e) => { if (!menu.contains(e.target)) cerrarMenu(); });

// Controles
const control = (action, value) => invoke("media_control", { action, value });
$("btn-play").addEventListener("click", () => control("toggle"));
$("btn-next").addEventListener("click", () => control("next"));
$("btn-prev").addEventListener("click", () => control("prev"));

const barra = $("barra-tiempo");
barra.addEventListener("pointerdown", () => { arrastrando = true; });
barra.addEventListener("input", () => {
  arrastrando = true;
  const ms = (barra.value / 1000) * base.dur;
  texto("t-actual", fmt(ms));
  barra.style.setProperty("--avance", `${barra.value / 10}%`);
});
barra.addEventListener("change", () => {
  const ms = Math.round((barra.value / 1000) * base.dur);
  base = { ...base, pos: ms, at: performance.now() };
  control("seek", ms);
  arrastrando = false;
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return cerrarMenu();
  // Las flechas mueven el carrusel aunque una portada tenga el foco.
  if (mostrarCarrusel && !e.ctrlKey && (e.key === "ArrowRight" || e.key === "ArrowLeft") && !e.target.closest("input")) {
    e.preventDefault();
    return irA(indice + (e.key === "ArrowRight" ? 1 : -1));
  }
  if (e.target.closest("input, button, .chat")) return;
  if (e.code === "Space") { e.preventDefault(); control("toggle"); }
  if (e.key === "ArrowRight" && e.ctrlKey) return control("next");
  if (e.key === "ArrowLeft" && e.ctrlKey) return control("prev");
});

// La posición se adelanta sola entre cada aviso de Windows para que la barra fluya.
function animar() {
  if (!arrastrando && base.dur > 0) {
    let pos = base.playing ? base.pos + (performance.now() - base.at) : base.pos;
    pos = Math.min(pos, base.dur);
    const v = Math.round((pos / base.dur) * 1000);
    barra.value = v;
    barra.style.setProperty("--avance", `${v / 10}%`);
    texto("t-actual", fmt(pos));
    seguirLetra(pos);
    avisarLinea(pos);
    if (!$("constelacion").hidden) constel.actualizar(letra.lineas, pos);
    if (!$("mensajes").hidden) msj.actualizar(letra.lineas, pos);
  } else if (!arrastrando) {
    barra.value = 0;
    barra.style.setProperty("--avance", "0%");
    texto("t-actual", estado?.now ? "" : "0:00");
  }
  requestAnimationFrame(animar);
}
requestAnimationFrame(animar);

// ---------- Letra ----------

// Le pasa a la isla dinámica la línea que va sonando.
let lineaAvisada = null;
function avisarLinea(pos) {
  let t = "";
  for (const l of letra.lineas) { if (l.t <= pos + 250) t = l.texto; else break; }
  if (t !== lineaAvisada) {
    lineaAvisada = t;
    emit("aura://linea", t === "♪" ? "" : t).catch(() => {});
  }
}

async function cargarLetra(n, clave) {
  letra = { clave, lineas: [], plano: null, activa: -1 };
  pintarLetra();
  try {
    const r = await invoke("get_lyrics", {
      artist: n.artist, title: n.title, album: n.album, durationMs: n.durationMs,
    });
    if (letra.clave !== clave) return; // ya cambió la canción
    letra.lineas = r.synced ? leerLrc(r.synced) : [];
    letra.plano = !letra.lineas.length && r.plain ? r.plain : null;
  } catch (e) {
    console.warn("Letra no disponible:", e);
  }
  pintarLetra();
}

/** Convierte "[01:23.45] texto" en [{ t: 83450, texto }]. */
function leerLrc(lrc) {
  const lineas = [];
  for (const fila of lrc.split(/\r?\n/)) {
    const marcas = [...fila.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!marcas.length) continue;
    const textoLinea = fila.replace(/\[[^\]]*\]/g, "").trim() || "♪";
    for (const m of marcas) lineas.push({ t: (Number(m[1]) * 60 + Number(m[2])) * 1000, texto: textoLinea });
  }
  return lineas.sort((a, b) => a.t - b.t);
}

function pintarLetra() {
  const hay = letra.lineas.length > 0 || !!letra.plano;
  const caja = $("letra-lineas");
  caja.replaceChildren();
  caja.style.transform = "translateY(0)";
  letra.activa = -1;

  if (letra.lineas.length) {
    letra.lineas.forEach((l, i) => {
      const p = document.createElement("p");
      p.className = "linea";
      p.textContent = l.texto;
      p.dataset.i = i;
      p.addEventListener("click", () => {
        if (!estado?.now?.canSeek) return;
        base = { ...base, pos: l.t, at: performance.now() };
        control("seek", Math.round(l.t));
      });
      caja.append(p);
    });
  } else if (letra.plano) {
    const aviso = document.createElement("p");
    aviso.className = "letra-aviso";
    aviso.textContent = "Esta letra no está sincronizada.";
    caja.append(aviso);
    for (const fila of letra.plano.split(/\r?\n/)) {
      const p = document.createElement("p");
      p.className = "linea plana";
      p.textContent = fila || " ";
      caja.append(p);
    }
  }

  $("letra").classList.toggle("plana", !letra.lineas.length && !!letra.plano);
  $("btn-letra").disabled = !hay;
  const visible = hay && mostrarLetra && !mostrarCarrusel;
  // Constelación y mensajes necesitan tiempos; si la letra no está sincronizada se usa la lista.
  const sincronizada = letra.lineas.length > 0;
  const usarConst = visible && estiloLetra === "constelacion" && sincronizada;
  const usarMsj = visible && estiloLetra === "mensajes" && sincronizada;
  $("letra").hidden = !visible || usarConst || usarMsj;
  $("constelacion").hidden = !usarConst;
  $("mensajes").hidden = !usarMsj;
  document.body.classList.toggle("estilo-constelacion", usarConst);
  document.body.classList.toggle("estilo-mensajes", usarMsj);
  constel.reiniciar();
  msj.reiniciar();
  if (visible && estiloLetra !== "lista" && !sincronizada && avisoSinTiempos !== letra.clave) {
    avisoSinTiempos = letra.clave;
    avisar(`Esta letra no trae tiempos; se muestra en lista en vez de ${NOMBRE_ESTILO[estiloLetra]}`);
  }
  document.body.classList.toggle("con-letra", visible);
}

/** Marca la línea que va sonando y la mantiene un poco arriba del centro. */
function seguirLetra(pos) {
  if (!letra.lineas.length || $("letra").hidden) return;
  const adelanto = 250; // las líneas aparecen un instante antes, como en Apple Music
  let i = -1;
  for (let k = 0; k < letra.lineas.length; k++) {
    if (letra.lineas[k].t <= pos + adelanto) i = k; else break;
  }
  if (i === letra.activa) return;
  letra.activa = i;
  const caja = $("letra-lineas");
  const filas = caja.children;
  for (let k = 0; k < filas.length; k++) {
    filas[k].classList.toggle("activa", k === i);
    filas[k].classList.toggle("pasada", k < i);
  }
  if (i < 0) { caja.style.transform = "translateY(0)"; return; }
  const fila = filas[i];
  const alto = $("letra").clientHeight;
  const y = Math.max(0, fila.offsetTop + fila.offsetHeight / 2 - alto * 0.36);
  caja.style.transform = `translateY(${-y}px)`;
}

$("btn-letra").addEventListener("click", () => {
  // Ciclo: lista → constelación → mensajes → oculta
  if (!mostrarLetra || mostrarCarrusel) ponerEstiloLetra("lista");
  else {
    const i = ESTILOS_LETRA.indexOf(estiloLetra);
    ponerEstiloLetra(i === ESTILOS_LETRA.length - 1 ? "oculta" : ESTILOS_LETRA[i + 1]);
  }
  avisar(!mostrarLetra ? "Letra oculta" : `Letra: ${NOMBRE_ESTILO[estiloLetra]}`);
});

/** estilo: "lista" | "constelacion" | "mensajes" | "oculta" */
function ponerEstiloLetra(estilo) {
  mostrarLetra = estilo !== "oculta";
  if (mostrarLetra) estiloLetra = estilo;
  localStorage.setItem("aura.estiloLetra", estiloLetra);
  localStorage.setItem("aura.mostrarLetra", mostrarLetra ? "si" : "no");
  actualizarBotonLetra();
  if (mostrarCarrusel) ponerCarrusel(false); else pintarLetra();
}

function actualizarBotonLetra() {
  $("btn-letra").setAttribute("aria-pressed", String(mostrarLetra));
  $("btn-letra").setAttribute("aria-label", !mostrarLetra ? "Mostrar letra" : `Letra en ${NOMBRE_ESTILO[estiloLetra]}. Cambiar estilo`);
}

// Reloj grande
function pintarReloj() {
  const d = new Date();
  texto("reloj-fecha", d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" }));
  texto("reloj-hora", d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false }));
}
pintarReloj();
setInterval(pintarReloj, 5000);
actualizarBotonLetra();

// ---------- Carrusel ----------
// Windows no da la cola de reproducción, así que el carrusel muestra el historial de lo que ha sonado.

const HIST_MAX = 30;
let historial = cargarHistorial();
let indice = historial.length - 1;
let mostrarCarrusel = false;

function cargarHistorial() {
  try { return JSON.parse(localStorage.getItem("aura.historial")) ?? []; } catch { return []; }
}

function guardarHistorial() {
  // Las portadas leídas de la app son muy pesadas para guardarse; solo se guardan las de internet.
  const ligero = historial.map((h) => ({ ...h, cover: h.cover?.startsWith("http") ? h.cover : null }));
  try { localStorage.setItem("aura.historial", JSON.stringify(ligero)); } catch {}
}

function registrarCancion(n) {
  // Sin artista suele ser una pestaña que no es música (un video cualquiera, una página).
  if (!n.title || !n.artist) return;
  const clave = `${n.artist}|${n.title}`;
  const ultimo = historial[historial.length - 1];
  if (ultimo?.clave === clave) {
    if (n.cover && ultimo.cover !== n.cover) {
      ultimo.cover = n.cover;
      guardarHistorial();
      pintarCarrusel(true);
    }
    return;
  }
  const seguia = indice >= historial.length - 1;
  historial = historial.filter((h) => h.clave !== clave);
  historial.push({ clave, title: n.title, artist: n.artist, album: n.album, cover: n.cover ?? null, at: Date.now() });
  if (historial.length > HIST_MAX) historial = historial.slice(-HIST_MAX);
  indice = seguia ? historial.length - 1 : Math.min(indice, historial.length - 1);
  guardarHistorial();
  pintarCarrusel(true);
}

const NOTA = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

function pintarCarrusel(reconstruir = false) {
  if (!mostrarCarrusel) return;
  const pista = $("pista");
  if (reconstruir) {
    pista.replaceChildren();
    historial.forEach((h, i) => {
      const b = document.createElement("button");
      b.className = "tarjeta";
      b.setAttribute("aria-label", `${h.title}, ${h.artist}`);
      if (h.cover) {
        const img = document.createElement("img");
        img.src = h.cover;
        img.alt = "";
        img.draggable = false;
        b.append(img);
      } else {
        const v = document.createElement("div");
        v.className = "tarjeta-vacia";
        v.innerHTML = NOTA;
        b.append(v);
      }
      const eq = document.createElement("span");
      eq.className = "eq";
      eq.setAttribute("aria-hidden", "true");
      eq.innerHTML = "<i></i><i></i><i></i>";
      b.append(eq);
      b.addEventListener("click", () => { if (!arrastre.movio) irA(i); });
      pista.append(b);
    });
  }

  const ultimo = historial.length - 1;
  [...pista.children].forEach((t, i) => {
    const pos = i - indice;
    const d = Math.abs(pos);
    const lado = Math.sign(pos);
    const forma = [
      [0, 0, 0, 1, 1],
      [68, -200, 35, 0.85, 0.9],
      [120, -350, 42, 0.72, 0.65],
      [162, -480, 48, 0.6, 0.3],
    ][Math.min(d, 3)];
    const [x, z, giro, escala] = forma;
    const opacidad = d > 3 ? 0 : forma[4];
    t.style.transform = `translate(calc(-50% + ${lado * x}%), -50%) translateZ(${z}px) rotateY(${-lado * giro}deg) scale(${escala})`;
    t.style.opacity = opacidad;
    t.style.zIndex = 10 - d;
    t.style.pointerEvents = d > 3 ? "none" : "auto";
    t.tabIndex = d > 3 ? -1 : 0;
    t.classList.toggle("centro", pos === 0);
    t.classList.toggle("sonando-ahora", i === ultimo && !!estado?.now);
  });

  const h = historial[indice];
  texto("car-estado", !h ? "Todavía no ha sonado nada. Pon música y aquí irá apareciendo."
    : indice === ultimo && estado?.now ? "Sonando ahora" : `Sonó ${haceCuanto(h.at)}`);
  texto("car-titulo", h?.title ?? "");
  texto("car-artista", h?.artist ?? "");
  $("car-prev").disabled = indice <= 0;
  $("car-next").disabled = indice >= ultimo;
}

function irA(i) {
  const nuevo = Math.max(0, Math.min(historial.length - 1, i));
  if (nuevo === indice) return;
  indice = nuevo;
  pintarCarrusel();
}

const relativo = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
function haceCuanto(t) {
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return relativo.format(-min, "minute");
  const horas = Math.round(min / 60);
  if (horas < 24) return relativo.format(-horas, "hour");
  return relativo.format(-Math.round(horas / 24), "day");
}

$("car-prev").addEventListener("click", () => irA(indice - 1));
$("car-next").addEventListener("click", () => irA(indice + 1));

// Rueda del mouse: un paso por cada giro (acumulado para que no salte de más).
let ruedaAcumulada = 0;
$("pista").addEventListener("wheel", (e) => {
  e.preventDefault();
  ruedaAcumulada += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (Math.abs(ruedaAcumulada) >= 80) {
    irA(indice + Math.sign(ruedaAcumulada));
    ruedaAcumulada = 0;
  }
}, { passive: false });

// Arrastrar con el mouse o el dedo.
const arrastre = { x: 0, activo: false, movio: false };
$("pista").addEventListener("pointerdown", (e) => {
  arrastre.x = e.clientX; arrastre.activo = true; arrastre.movio = false;
});
window.addEventListener("pointerup", (e) => {
  if (!arrastre.activo) return;
  arrastre.activo = false;
  const dx = e.clientX - arrastre.x;
  if (Math.abs(dx) > 40) {
    arrastre.movio = true;
    irA(indice - Math.sign(dx) * Math.max(1, Math.round(Math.abs(dx) / 160)));
    setTimeout(() => { arrastre.movio = false; }, 0);
  }
});

$("btn-carrusel").addEventListener("click", () => ponerCarrusel(!mostrarCarrusel));

function ponerCarrusel(si) {
  mostrarCarrusel = si;
  if (mostrarCarrusel) indice = historial.length - 1;
  document.body.classList.toggle("con-carrusel", mostrarCarrusel);
  $("carrusel").hidden = !mostrarCarrusel;
  $("btn-carrusel").setAttribute("aria-pressed", String(mostrarCarrusel));
  $("btn-carrusel").setAttribute("aria-label", mostrarCarrusel ? "Ocultar carrusel" : "Mostrar carrusel");
  pintarLetra();
  pintarCarrusel(true);
}

// ---------- IA ----------

function ponerVista(v) {
  if (v === "carrusel") return ponerCarrusel(true);
  if (v === "constelación") v = "constelacion";
  if (v === "letra") v = "lista";
  ponerEstiloLetra(ESTILOS_LETRA.includes(v) ? v : "oculta");
}

function contextoParaIA() {
  const n = estado?.now;
  const ahora = new Date().toLocaleString("es-MX", { weekday: "long", hour: "2-digit", minute: "2-digit" });
  const partes = [`Fecha y hora: ${ahora}.`];
  if (n) {
    partes.push(`Sonando: "${n.title}" de ${n.artist}${n.album ? ` (álbum ${n.album})` : ""}, en ${n.sourceName}, ${n.playing ? "reproduciendo" : "en pausa"}.`);
  } else {
    partes.push("No hay música sonando.");
  }
  const recientes = historial.slice(-8, -1).reverse().map((h) => `${h.title} - ${h.artist}`);
  if (recientes.length) partes.push(`Sonó antes: ${recientes.join("; ")}.`);
  if (letra.lineas.length || letra.plano) {
    const texto = letra.lineas.length ? letra.lineas.map((l) => l.texto).join("\n") : letra.plano;
    partes.push(`Letra (solo para que entiendas la canción, no la copies):\n${texto.slice(0, 2500)}`);
  }
  return partes.join("\n");
}

iniciarAjustes({
  obtenerPortada: () => {
    const src = $("portada").getAttribute("src");
    return estado?.now && src && !$("portada").hidden ? src : null;
  },
  letra: {
    obtener: () => (mostrarLetra ? estiloLetra : "oculta"),
    poner: ponerEstiloLetra,
  },
});

iniciarChat({
  contexto: contextoParaIA,
  acciones: {
    pausa: () => control("toggle"),
    siguiente: () => control("next"),
    anterior: () => control("prev"),
    escena: (v) => ponerEscena(v.toLowerCase().replace("á", "a")),
    efectos: (v) => ponerModoEfectos(v.toLowerCase()),
    vista: (v) => ponerVista(v.toLowerCase()),
    buscar: (v) => {
      if (!v) return;
      invoke("open_url", { url: `https://music.youtube.com/search?q=${encodeURIComponent(v)}` });
    },
  },
});

function texto(id, valor) {
  const el = $(id);
  const v = valor ?? "";
  if (el.textContent !== v) el.textContent = v;
}

function imagen(img, src) {
  if (!src) {
    img.classList.remove("visible");
    img.hidden = img.id === "portada";
    return;
  }
  img.hidden = false;
  if (img.getAttribute("src") !== src) img.src = src;
  img.classList.add("visible");
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
