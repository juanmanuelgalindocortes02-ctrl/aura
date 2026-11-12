# Aura · Fase 1

App de escritorio para Windows que detecta la app de música que tengas abierta (Spotify, Apple Music, YouTube Music en el navegador, etc.) y la controla.

## Requisitos (una sola vez)

1. **Rust:** instálalo desde https://rustup.rs (opción por defecto).
2. **Microsoft C++ Build Tools:** en el instalador de Visual Studio Build Tools marca "Desarrollo para el escritorio con C++".
3. **Node.js 18 o más nuevo.**
4. **WebView2:** ya viene en Windows 10 y 11.

## Correrla

```
npm install
npm run tauri dev
```

La primera compilación de Rust tarda unos minutos; las siguientes son rápidas.

## Instalador (.exe / .msi)

```
npm run tauri build
```

Queda en `src-tauri/target/release/bundle/`.

## Qué hace esta fase

- Lista las apps con sesión multimedia abierta y su estado (sonando, en pausa).
- Modo automático: sigue a la que Windows considere actual.
- Muestra título, artista, álbum y portada, con el fondo tomado de la portada.
- Reproducir/pausar, anterior, siguiente y adelantar (si la app lo permite).
- Teclas: espacio para reproducir/pausar, Ctrl + flechas para cambiar de canción.

## Archivos clave

- `src-tauri/src/media.rs`: lectura de Windows (SMTC) y controles.
- `src-tauri/src/lib.rs`: comandos que llama la interfaz.
- `src/main.js` y `src/style.css`: la interfaz.

## Fondo de pantalla e inicio con Windows

Aura tiene un ícono en la bandeja del sistema (junto al reloj) con estas opciones:

- **Fondo de pantalla:** pone Aura detrás de los íconos del escritorio. Los efectos se pausan solos cuando abres un juego o maximizas una ventana.
- **Abrir en ventana:** la regresa a ventana normal.
- **Iniciar con Windows:** arranca Aura al encender la compu, directo como fondo.
- **Salir.**

Para que "Iniciar con Windows" funcione hay que **instalar** Aura (no usar `npm run tauri dev`):

```
npm run tauri build
```

Instala el `.exe` que queda en `src-tauri/target/release/bundle/nsis/`, abre Aura desde el menú Inicio y activa la opción en la bandeja.

## IA (chat con Aura)

Aura usa una IA local con Ollama: gratis, privada y sin internet.

1. Instala Ollama desde https://ollama.com (se queda abierto en segundo plano).
2. En una terminal descarga el modelo (unos 2 GB, una sola vez):
   ```
   ollama pull qwen2.5:3b
   ```
3. En Aura, abre el chat con el botón del globito con puntos.

Para usar otro modelo, crea la variable de entorno `AURA_MODELO` (por ejemplo `llama3.2:3b`).
