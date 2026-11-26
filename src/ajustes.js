// Menú "Personalizar": estilo de letra, escena de efectos, fondo, color y borde neón.
// Todo se guarda y se aplica al instante.

import { ponerEscena, ponerModoEfectos, obtenerEscena, obtenerModo, fijarAcento } from "./efectos.js";

const $ = (id) => document.getElementById(id);
const guardado = (k, def) => { try { return localStorage.getItem(k) ?? def; } catch { return def; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const ajustes = {
  fondo: guardado("aura.fondo", "portada"),
  colorFondo: guardado("aura.colorFondo", "#140d24"),
  acento: guardado("aura.acento", "portada"),
  borde: guardado("aura.borde", "no") === "si",
};

const COLORES = [
  ["portada", "De la portada"],
  ["#ff4fa3", "Rosa"],
  ["#8b5cf6", "Violeta"],
  ["#38bdf8", "Azul"],
  ["#34d399", "Verde"],
  ["#fbbf24", "Ámbar"],
  ["#f43f5e", "Rojo"],
];

// Mini dibujos de cada opción. Las piezas con var(--bajo) se mueven con la música.
const VISTAS = {
  lista: `<div class="v-lista"><i></i><i class="on"></i><i></i></div>`,
  constelacion: `<svg viewBox="0 0 120 70" class="v-const"><polyline points="14,48 40,20 66,40 92,16 108,44"/><circle cx="14" cy="48" r="2.5"/><circle cx="40" cy="20" r="2.5"/><circle cx="66" cy="40" r="2.5"/><circle cx="92" cy="16" r="2.5"/><circle cx="108" cy="44" r="4" class="on"/></svg>`,
  mensajes: `<div class="v-msj"><i class="otro"></i><i class="yo"></i><i class="otro corto"></i></div>`,
  oculta: `<div class="v-oculta"><span></span></div>`,
  cintas: `<svg viewBox="0 0 120 70" class="v-cintas"><path d="M0 50 Q30 30 60 48 T120 44"/><path d="M0 56 Q30 44 60 58 T120 50" class="b"/></svg>`,
  synthwave: `<div class="v-synth"><span class="sol"></span><span class="piso"></span></div>`,
  laser: `<svg viewBox="0 0 120 70" class="v-laser"><line x1="0" y1="70" x2="70" y2="0"/><line x1="0" y1="70" x2="110" y2="10" class="b"/><line x1="120" y1="70" x2="50" y2="0" class="b"/><line x1="120" y1="70" x2="10" y2="12"/></svg>`,
  anillo: `<div class="v-anillo"><span></span></div>`,
  apagado: `<div class="v-oculta"><span></span></div>`,
};

let opciones = null;

/** o.obtenerPortada(): url de la portada actual. o.letra: { obtener(), poner(estilo) } */
export function iniciarAjustes(o) {
  opciones = o;
  aplicarFondo();
  aplicarBorde();
  if (ajustes.acento !== "portada") fijarAcento(ajustes.acento);

  $("btn-ajustes").addEventListener("click", () => abrir(true));
  $("ajustes-cerrar").addEventListener("click", () => abrir(false));
  $("ajustes").addEventListener("click", (e) => { if (e.target.id === "ajustes") abrir(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("ajustes").hidden) abrir(false); });
}

function abrir(si) {
  $("ajustes").hidden = !si;
  $("btn-ajustes").setAttribute("aria-expanded", String(si));
  if (si) {
    pintar();
    $("ajustes-cerrar").focus();
  } else {
    $("btn-ajustes").focus();
  }
}

/** Repinta el menú con lo que está elegido ahora. */
function pintar() {
  const letra = opciones.letra.obtener();
  mosaicos("aj-letra", [
    ["lista", "Lista"], ["constelacion", "Constelación"], ["mensajes", "Mensajes"], ["oculta", "Sin letra"],
  ], letra, (v) => { opciones.letra.poner(v); pintar(); });

  const escena = obtenerModo() === "apagado" ? "apagado" : obtenerEscena();
  mosaicos("aj-escena", [
    ["cintas", "Cintas de neón"], ["synthwave", "Synthwave"], ["laser", "Láser"], ["anillo", "Anillo"], ["apagado", "Sin efectos"],
  ], escena, (v) => {
    if (v === "apagado") ponerModoEfectos("apagado");
    else {
      if (obtenerModo() === "apagado") ponerModoEfectos("completo");
      ponerEscena(v);
    }
    pintar();
  });

  // Intensidad de los efectos
  const modo = obtenerModo();
  for (const b of document.querySelectorAll("#aj-intensidad button")) {
    b.setAttribute("aria-pressed", String(b.dataset.v === modo));
    b.disabled = modo === "apagado";
    b.onclick = () => { ponerModoEfectos(b.dataset.v); pintar(); };
  }

  // Fondo
  const portada = opciones.obtenerPortada();
  const fondos = [
    ["portada", "Portada difuminada"], ["nitida", "Portada nítida"], ["color", "Color sólido"], ["imagen", "Tu imagen"],
  ];
  mosaicos("aj-fondo", fondos, ajustes.fondo, (v) => {
    if (v === "imagen" && !guardado("aura.fondoImagen", null)) return $("aj-archivo").click();
    ajustes.fondo = v;
    guardar("aura.fondo", v);
    aplicarFondo();
    pintar();
  }, (id, vista) => {
    if ((id === "portada" || id === "nitida") && portada) {
      vista.style.backgroundImage = `url("${portada}")`;
      vista.classList.add(id === "portada" ? "v-borrosa" : "v-nitida");
    } else if (id === "color") {
      vista.style.background = ajustes.colorFondo;
    } else if (id === "imagen") {
      const img = guardado("aura.fondoImagen", null);
      if (img) vista.style.backgroundImage = `url("${img}")`;
      else vista.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`;
      vista.classList.add("v-imagen");
    }
  });
  $("aj-color-fondo").value = ajustes.colorFondo;
  $("aj-fila-color-fondo").hidden = ajustes.fondo !== "color";
  $("aj-cambiar-imagen").hidden = ajustes.fondo !== "imagen";

  // Color de acento
  const caja = $("aj-acento");
  caja.replaceChildren();
  for (const [v, nombre] of COLORES) {
    const b = document.createElement("button");
    b.className = "muestra";
    b.setAttribute("aria-label", nombre);
    b.title = nombre;
    b.setAttribute("aria-pressed", String(ajustes.acento === v));
    b.style.background = v === "portada"
      ? (portada ? `center / cover url("${portada}")` : "conic-gradient(#ff4fa3, #8b5cf6, #38bdf8, #34d399, #fbbf24, #ff4fa3)")
      : v;
    b.onclick = () => ponerAcento(v);
    caja.append(b);
  }
  $("aj-acento-propio").value = ajustes.acento.startsWith("#") ? ajustes.acento : "#ff4fa3";

  // Borde neón
  $("aj-borde").setAttribute("aria-checked", String(ajustes.borde));
}

/** Pinta una fila de mosaicos con vista previa; el elegido queda marcado. */
function mosaicos(id, lista, elegido, alElegir, decorar) {
  const caja = $(id);
  caja.replaceChildren();
  for (const [v, nombre] of lista) {
    const b = document.createElement("button");
    b.className = "mosaico";
    b.setAttribute("aria-pressed", String(v === elegido));
    const vista = document.createElement("span");
    vista.className = "mosaico-vista";
    vista.setAttribute("aria-hidden", "true");
    vista.innerHTML = VISTAS[v] ?? "";
    decorar?.(v, vista);
    const etiqueta = document.createElement("span");
    etiqueta.className = "mosaico-nombre";
    etiqueta.textContent = nombre;
    b.append(vista, etiqueta);
    b.onclick = () => alElegir(v);
    caja.append(b);
  }
}

function ponerAcento(v) {
  ajustes.acento = v;
  guardar("aura.acento", v);
  fijarAcento(v === "portada" ? null : v);
  pintar();
}

function aplicarFondo() {
  const b = document.body.classList;
  b.toggle("fondo-nitido", ajustes.fondo === "nitida");
  b.toggle("fondo-color", ajustes.fondo === "color");
  b.toggle("fondo-imagen", ajustes.fondo === "imagen");
  document.documentElement.style.setProperty("--fondo-color", ajustes.colorFondo);
  const propia = $("fondo-propio");
  const img = ajustes.fondo === "imagen" ? guardado("aura.fondoImagen", null) : null;
  if (img) propia.src = img; else propia.removeAttribute("src");
}

function aplicarBorde() {
  document.body.classList.toggle("con-borde", ajustes.borde);
}

// Controles que no se reconstruyen
$("aj-color-fondo").addEventListener("input", (e) => {
  ajustes.colorFondo = e.target.value;
  guardar("aura.colorFondo", ajustes.colorFondo);
  aplicarFondo();
});
$("aj-acento-propio").addEventListener("change", (e) => ponerAcento(e.target.value));
$("aj-cambiar-imagen").addEventListener("click", () => $("aj-archivo").click());
$("aj-borde").addEventListener("click", () => {
  ajustes.borde = !ajustes.borde;
  guardar("aura.borde", ajustes.borde ? "si" : "no");
  aplicarBorde();
  pintar();
});

// Imagen propia: se reduce a 1920 px para que quepa guardada y no pese.
$("aj-archivo").addEventListener("change", (e) => {
  const archivo = e.target.files?.[0];
  e.target.value = "";
  if (!archivo) return;
  const url = URL.createObjectURL(archivo);
  const img = new Image();
  img.onload = () => {
    const escala = Math.min(1, 1920 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    try {
      localStorage.setItem("aura.fondoImagen", c.toDataURL("image/jpeg", 0.85));
    } catch {
      alert("Esa imagen es demasiado grande. Prueba con una más ligera.");
      return;
    }
    ajustes.fondo = "imagen";
    guardar("aura.fondo", "imagen");
    aplicarFondo();
    pintar();
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
});
