// Letra tipo mensajes: cada línea llega como una burbuja de chat, alternando lados,
// como si la canción fuera una conversación. Antes de cada línea aparece "escribiendo…".

const ADELANTO = 250;
const VISIBLES = 7;
const ESCRIBIENDO_ANTES = 1400;

export class Mensajes {
  constructor(caja) {
    this.caja = caja;
    this.lista = document.createElement("div");
    this.lista.className = "msj-lista";
    caja.append(this.lista);
    this.reiniciar();
  }

  reiniciar() {
    this.linea = -2;
    this.lado = 0;
    this.escribiendo = null;
    this.lista.replaceChildren();
  }

  actualizar(lineas, pos) {
    let i = -1;
    for (let k = 0; k < lineas.length; k++) {
      if (lineas[k].t <= pos + ADELANTO) i = k; else break;
    }

    if (i < this.linea) {
      // Se regresó la canción: se rearma la conversación hasta esa línea, sin animación.
      this.reiniciar();
      for (let k = Math.max(0, i - VISIBLES + 1); k <= i; k++) this.agregar(lineas[k].texto, false);
      this.linea = i;
    } else {
      while (this.linea < i) {
        this.linea++;
        if (this.linea >= 0) this.agregar(lineas[this.linea].texto, i - this.linea < 2);
      }
    }

    // Burbuja de "escribiendo…" poco antes de la siguiente línea.
    const sig = lineas[i + 1];
    const toca = sig && sig.t - (pos + ADELANTO) < ESCRIBIENDO_ANTES && sig.texto !== "♪";
    if (toca && !this.escribiendo) this.mostrarEscribiendo();
    if (!toca && this.escribiendo) this.quitarEscribiendo();
  }

  agregar(texto, animar) {
    this.quitarEscribiendo();
    if (!texto || texto === "♪") return;
    // Cada 1 o 2 líneas cambia de lado, para que se sienta como una plática.
    const p = document.createElement("p");
    p.className = `msj ${this.lado % 2 ? "yo" : "otro"}${animar ? " llega" : ""}`;
    p.textContent = texto;
    this.lado += this.lista.children.length % 3 === 2 ? 2 : 1;
    for (const viejo of this.lista.querySelectorAll(".msj.actual")) viejo.classList.remove("actual");
    p.classList.add("actual");
    this.lista.append(p);
    while (this.lista.querySelectorAll(".msj").length > VISIBLES) this.lista.querySelector(".msj").remove();
  }

  mostrarEscribiendo() {
    const p = document.createElement("p");
    p.className = `msj escribiendo ${this.lado % 2 ? "yo" : "otro"}`;
    p.setAttribute("aria-hidden", "true");
    p.innerHTML = "<i></i><i></i><i></i>";
    this.lista.append(p);
    this.escribiendo = p;
  }

  quitarEscribiendo() {
    this.escribiendo?.remove();
    this.escribiendo = null;
  }
}
