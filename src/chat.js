// Chat con Aura (IA local con Ollama): platica, explica canciones, recomienda y controla el reproductor.

import { invoke } from "@tauri-apps/api/core";

const SUGERENCIAS = [
  "¿De qué trata esta canción?",
  "Recomiéndame algo parecido",
  "Ponle un ambiente más tranquilo",
  "Cuéntame algo del artista",
];

let mensajes = [];
let ocupado = false;
let opciones = null;

const $ = (id) => document.getElementById(id);

/**
 * opciones.contexto(): texto con lo que está sonando.
 * opciones.acciones: { pausa, siguiente, anterior, escena(v), efectos(v), vista(v), buscar(v) }
 */
export function iniciarChat(o) {
  opciones = o;
  $("btn-chat").addEventListener("click", () => alternarChat());
  $("chat-cerrar").addEventListener("click", () => alternarChat(false));
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("chat-texto").value.trim();
    if (t) enviar(t);
  });
  const chips = $("chat-sugerencias");
  for (const s of SUGERENCIAS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = s;
    b.addEventListener("click", () => enviar(s));
    chips.append(b);
  }
  agregarBurbuja("assistant", "¡Qué onda! Soy Aura. Pregúntame de la canción, pídeme recomendaciones o dime qué ambiente quieres.");
}

function alternarChat(abrir) {
  const panel = $("chat");
  const ahora = abrir ?? panel.hidden;
  panel.hidden = !ahora;
  document.body.classList.toggle("con-chat", ahora);
  $("btn-chat").setAttribute("aria-pressed", String(ahora));
  if (ahora) $("chat-texto").focus();
}

async function enviar(texto) {
  if (ocupado) return;
  ocupado = true;
  $("chat-texto").value = "";
  $("chat-sugerencias").hidden = true;
  mensajes.push({ role: "user", content: texto });
  agregarBurbuja("user", texto);
  const pensando = agregarBurbuja("assistant", "Pensando…", "pensando");
  $("chat-enviar").disabled = true;

  try {
    const r = await invoke("ask_ai", { messages: mensajes, context: opciones.contexto() });
    const respuesta = (r.respuesta || "").trim() || "Listo.";
    pensando.remove();
    agregarBurbuja("assistant", respuesta);
    mensajes.push({ role: "assistant", content: respuesta });
    for (const a of r.acciones ?? []) ejecutar(a);
  } catch (e) {
    pensando.remove();
    agregarBurbuja("assistant", String(e), "error");
  } finally {
    ocupado = false;
    $("chat-enviar").disabled = false;
    $("chat-texto").focus();
  }
}

function ejecutar(a) {
  const f = opciones.acciones[a.tipo];
  if (!f) return;
  try { f(a.valor ?? ""); } catch (e) { console.warn("Acción de la IA falló:", a, e); }
}

function agregarBurbuja(rol, texto, extra = "") {
  const p = document.createElement("p");
  p.className = `burbuja ${rol} ${extra}`.trim();
  p.textContent = texto;
  const lista = $("chat-mensajes");
  lista.append(p);
  lista.scrollTop = lista.scrollHeight;
  return p;
}
