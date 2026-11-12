// Letra en modo "constelación": cada palabra aparece como una estrella en un recorrido
// que se va uniendo con líneas. La palabra que suena se ve grande y brillante.

const NS = "http://www.w3.org/2000/svg";
const ADELANTO = 250;

/** Números "al azar" pero siempre iguales para la misma línea (así no brinca al repintar). */
function semilla(n) {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Constelacion {
  constructor(caja) {
    this.caja = caja;
    this.svg = document.createElementNS(NS, "svg");
    this.svg.setAttribute("class", "const-svg");
    this.svg.setAttribute("aria-hidden", "true");
    this.capa = document.createElement("div");
    this.capa.className = "const-capa";
    this.grande = document.createElement("div");
    this.grande.className = "const-grande";
    caja.append(this.svg, this.capa, this.grande);
    this.reiniciar();
  }

  reiniciar() {
    this.linea = -2;
    this.visibles = 0;
    this.grupo = null;
    this.palabras = [];
    this.puntos = [];
    this.svg.replaceChildren();
    this.capa.replaceChildren();
    this.grande.textContent = "";
    this.grande.classList.remove("visible");
  }

  actualizar(lineas, pos) {
    let i = -1;
    for (let k = 0; k < lineas.length; k++) {
      if (lineas[k].t <= pos + ADELANTO) i = k; else break;
    }
    if (i !== this.linea) this.nuevaLinea(lineas, i);
    if (i < 0 || !this.palabras.length) return;

    let k = 0;
    while (k < this.palabras.length && this.palabras[k].t <= pos + ADELANTO) k++;
    if (k < this.visibles) {
      // Se regresó la canción: se rearma la línea sin animación.
      this.nuevaLinea(lineas, i, true);
    }
    while (this.visibles < k) this.revelar(this.visibles++, k - this.visibles > 1);
  }

  nuevaLinea(lineas, i, sinAnimar = false) {
    // La constelación anterior se desvanece.
    for (const viejo of [...this.svg.children, ...this.capa.children]) {
      viejo.classList.add("saliendo");
      setTimeout(() => viejo.remove(), 700);
    }
    this.grande.classList.remove("visible");
    this.linea = i;
    this.visibles = 0;
    this.palabras = [];
    this.puntos = [];
    if (i < 0) return;

    const l = lineas[i];
    const textos = l.texto.split(/\s+/).filter((w) => w && w !== "♪");
    if (!textos.length) return;

    // Cada palabra suena en proporción a su largo, dentro de la duración de la línea.
    const fin = lineas[i + 1]?.t ?? l.t + 5000;
    const dur = Math.min(Math.max(fin - l.t, 800), 9000) * 0.85;
    const pesos = textos.map((w) => w.length + 2);
    const total = pesos.reduce((a, b) => a + b, 0);
    let acumulado = 0;
    this.palabras = textos.map((w, j) => {
      const t = l.t + (dur * acumulado) / total;
      acumulado += pesos[j];
      return { texto: w, t };
    });
    this.puntos = this.recorrido(textos.length, semilla(i * 9973 + l.texto.length * 31));
    this.grupo = document.createElementNS(NS, "g");
    this.svg.append(this.grupo);
    this.sinAnimar = sinAnimar;
  }

  /** Puntos de un recorrido que serpentea por la pantalla sin amontonarse. */
  recorrido(n, azar) {
    const ancho = this.caja.clientWidth;
    const alto = this.caja.clientHeight;
    const enFondo = document.body.classList.contains("fondo");
    const zona = {
      x0: ancho * (enFondo ? 0.24 : 0.1),
      x1: ancho * 0.82,
      y0: alto * 0.3,
      y1: alto * 0.66,
    };
    const paso = Math.max(90, Math.min(200, ancho / 9));
    const puntos = [{ x: zona.x0 + azar() * (zona.x1 - zona.x0) * 0.5, y: zona.y0 + azar() * (zona.y1 - zona.y0) }];
    let angulo = azar() * Math.PI * 2;
    for (let j = 1; j < n; j++) {
      const prev = puntos[j - 1];
      let mejor = null;
      for (let intento = 0; intento < 12; intento++) {
        const a = angulo + (azar() - 0.5) * (intento < 6 ? 3.2 : 6.28);
        const d = paso * (0.7 + azar() * 0.6);
        const p = { x: prev.x + Math.cos(a) * d, y: prev.y + Math.sin(a) * d };
        const dentro = p.x > zona.x0 && p.x < zona.x1 && p.y > zona.y0 && p.y < zona.y1;
        const lejos = puntos.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > paso * 0.45);
        if (dentro && lejos) { mejor = p; angulo = a; break; }
        if (!mejor && dentro) mejor = p;
      }
      puntos.push(mejor ?? {
        x: zona.x0 + azar() * (zona.x1 - zona.x0),
        y: zona.y0 + azar() * (zona.y1 - zona.y0),
      });
    }
    return puntos;
  }

  revelar(j, rapido) {
    const p = this.puntos[j];
    if (!p || !this.grupo) return;
    const animar = !this.sinAnimar && !rapido;

    // Líneas: con la palabra anterior y, a veces, con una más atrás (efecto telaraña).
    const unir = [];
    if (j > 0) unir.push(j - 1);
    if (j > 2 && (j * 7) % 3 === 0) unir.push(j - 3);
    if (j > 1 && (j * 5) % 4 === 1) unir.push(j - 2);
    for (const k of unir) {
      const q = this.puntos[k];
      const linea = document.createElementNS(NS, "line");
      linea.setAttribute("x1", q.x); linea.setAttribute("y1", q.y);
      linea.setAttribute("x2", p.x); linea.setAttribute("y2", p.y);
      linea.setAttribute("class", "const-linea");
      const largo = Math.hypot(p.x - q.x, p.y - q.y);
      linea.style.strokeDasharray = largo;
      linea.style.strokeDashoffset = animar ? largo : 0;
      this.grupo.append(linea);
      if (animar) requestAnimationFrame(() => { linea.style.strokeDashoffset = 0; });
    }

    // Estrella de cuatro puntas en el nodo.
    const estrella = document.createElementNS(NS, "path");
    const r = 7;
    estrella.setAttribute("d", `M${p.x} ${p.y - r} Q${p.x} ${p.y} ${p.x + r} ${p.y} Q${p.x} ${p.y} ${p.x} ${p.y + r} Q${p.x} ${p.y} ${p.x - r} ${p.y} Q${p.x} ${p.y} ${p.x} ${p.y - r}Z`);
    estrella.setAttribute("class", "const-estrella");
    this.grupo.append(estrella);

    // Mira circular sobre la palabra que está sonando.
    this.grupo.querySelector(".const-mira")?.remove();
    const mira = document.createElementNS(NS, "g");
    mira.setAttribute("class", "const-mira");
    mira.innerHTML = `<circle cx="${p.x}" cy="${p.y}" r="26"/><line x1="${p.x - 34}" y1="${p.y}" x2="${p.x + 34}" y2="${p.y}"/><line x1="${p.x}" y1="${p.y - 34}" x2="${p.x}" y2="${p.y + 34}"/>`;
    this.grupo.append(mira);

    // Etiqueta chiquita junto a la estrella.
    const etiqueta = document.createElement("span");
    etiqueta.className = "const-etiqueta";
    etiqueta.textContent = this.palabras[j].texto;
    etiqueta.style.left = `${p.x + 8}px`;
    etiqueta.style.top = `${p.y + 8}px`;
    this.capa.append(etiqueta);

    // La palabra actual en grande, debajo de su estrella.
    this.grande.textContent = this.palabras[j].texto;
    const ancho = this.caja.clientWidth;
    this.grande.style.left = `${Math.min(Math.max(p.x, ancho * 0.15), ancho * 0.85)}px`;
    this.grande.style.top = `${Math.min(p.y + 70, this.caja.clientHeight - 90)}px`;
    this.grande.classList.remove("visible");
    void this.grande.offsetWidth;
    this.grande.classList.add("visible");
  }
}
