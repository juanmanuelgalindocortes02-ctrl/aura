mod audio;
mod fondo;
mod ia;
mod lyrics;
mod media;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// Canal hacia el hilo que habla con Windows (todas las llamadas WinRT viven ahí).
struct MediaTx(Mutex<Sender<media::Cmd>>);

impl MediaTx {
    fn send(&self, cmd: media::Cmd) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .send(cmd)
            .map_err(|e| e.to_string())
    }
}

/// Prende o apaga el análisis de audio (cuando los efectos están apagados no gasta nada).
struct Visualizador(Arc<AtomicBool>);

/// ¿Está Aura como fondo de pantalla?
struct ModoFondo(Arc<AtomicBool>);

/// ¿Está prendida la isla dinámica?
struct IslaActiva(Arc<AtomicBool>);

/// Controles: "toggle", "next", "prev" o "seek" (con value en milisegundos).
#[tauri::command]
fn media_control(action: String, value: Option<i64>, tx: tauri::State<MediaTx>) -> Result<(), String> {
    let cmd = match action.as_str() {
        "toggle" => media::Cmd::Toggle,
        "next" => media::Cmd::Next,
        "prev" => media::Cmd::Prev,
        "seek" => media::Cmd::Seek(value.unwrap_or(0)),
        otra => return Err(format!("Acción desconocida: {otra}")),
    };
    tx.send(cmd)
}

/// Elige la app a seguir: "auto" o el id de una sesión.
#[tauri::command]
fn select_source(id: String, tx: tauri::State<MediaTx>) -> Result<(), String> {
    tx.send(media::Cmd::Select(id))
}

#[tauri::command]
fn set_visualizer(on: bool, v: tauri::State<Visualizador>) {
    v.0.store(on, Ordering::Relaxed);
}

/// Busca la letra de la canción (se hace fuera del hilo principal porque usa internet).
#[tauri::command]
async fn get_lyrics(artist: String, title: String, album: String, duration_ms: i64) -> Result<lyrics::Lyrics, String> {
    tauri::async_runtime::spawn_blocking(move || lyrics::buscar(&artist, &title, &album, duration_ms))
        .await
        .map_err(|e| e.to_string())
}

/// Pregunta a la IA local (Ollama). Tarda unos segundos, así que corre fuera del hilo principal.
#[tauri::command]
async fn ask_ai(messages: Vec<ia::Mensaje>, context: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || ia::preguntar(messages, context))
        .await
        .map_err(|e| e.to_string())?
}

/// Abre una dirección en el navegador (para poner la canción que recomienda la IA).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("dirección no permitida".into());
    }
    #[cfg(windows)]
    std::process::Command::new("explorer").arg(&url).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Le dice a la interfaz en qué modo está (para esconder la barra en modo fondo).
#[tauri::command]
fn wallpaper_mode(m: tauri::State<ModoFondo>) -> bool {
    m.0.load(Ordering::Relaxed)
}

// ---------- Isla dinámica ----------

/// Acomoda la isla arriba al centro del monitor principal, chica o expandida.
fn acomodar_isla(w: &WebviewWindow, expandida: bool) -> Result<(), String> {
    let (ancho, alto) = if expandida { (460.0, 196.0) } else { (360.0, 64.0) };
    let monitor = w
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("no hay monitor")?;
    let escala = monitor.scale_factor();
    let (pos, tam) = (monitor.position(), monitor.size());
    let x = pos.x as f64 + (tam.width as f64 - ancho * escala) / 2.0;
    let y = pos.y as f64;
    w.set_size(PhysicalSize::new((ancho * escala) as u32, (alto * escala) as u32))
        .map_err(|e| e.to_string())?;
    w.set_position(PhysicalPosition::new(x as i32, y as i32))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn isla_tamano(app: AppHandle, expandida: bool) -> Result<(), String> {
    let w = app.get_webview_window("isla").ok_or("no hay isla")?;
    acomodar_isla(&w, expandida)
}

fn archivo_isla(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("isla.txt"))
}

fn isla_guardada(app: &AppHandle) -> bool {
    archivo_isla(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim() != "no")
        .unwrap_or(true)
}

fn poner_isla(app: &AppHandle, activar: bool) {
    app.state::<IslaActiva>().0.store(activar, Ordering::Relaxed);
    if let Some(p) = archivo_isla(app) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, if activar { "si" } else { "no" });
    }
    if let Some(w) = app.get_webview_window("isla") {
        if activar {
            let _ = acomodar_isla(&w, false);
            let _ = w.show();
        } else {
            let _ = w.hide();
        }
    }
}

// ---------- Modo fondo de pantalla ----------

fn archivo_modo(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("modo.txt"))
}

fn modo_guardado(app: &AppHandle) -> bool {
    archivo_modo(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim() == "fondo")
        .unwrap_or(false)
}

fn guardar_modo(app: &AppHandle, fondo: bool) {
    if let Some(p) = archivo_modo(app) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, if fondo { "fondo" } else { "ventana" });
    }
}

fn poner_fondo(app: &AppHandle, activar: bool) -> Result<(), String> {
    let win = app.get_webview_window("main").ok_or("no hay ventana")?;
    let raw = win.hwnd().map_err(|e| e.to_string())?.0 as isize;
    if activar {
        let _ = win.set_decorations(false);
        let _ = win.set_shadow(false); // la sombra de Windows 11 deja un borde de 1 px
        let _ = win.set_resizable(false);
        let _ = win.set_skip_taskbar(true);
        let _ = win.show(); // la vista web necesita estar "visible" para dibujar
        fondo::pegar(raw)?;
    } else {
        fondo::despegar(raw);
        let _ = win.set_resizable(true);
        let _ = win.set_decorations(true);
        let _ = win.set_skip_taskbar(false);
        let _ = win.set_size(LogicalSize::new(1100.0, 720.0));
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
    }
    app.state::<ModoFondo>().0.store(activar, Ordering::Relaxed);
    guardar_modo(app, activar);
    let _ = app.emit("fondo://modo", activar);
    Ok(())
}

/// Revisa cada 2 segundos si algo tapa el escritorio, para pausar los efectos (juegos, etc.),
/// y esconde la isla cuando hay algo en pantalla completa.
fn vigilar_escritorio(app: AppHandle, modo: Arc<AtomicBool>, isla: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let mut antes = false;
        let mut isla_oculta = false;
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let ahora = modo.load(Ordering::Relaxed) && fondo::tapado();
            if ahora != antes {
                antes = ahora;
                let _ = app.emit("fondo://tapado", ahora);
            }
            if isla.load(Ordering::Relaxed) {
                let completa = fondo::pantalla_completa();
                if completa != isla_oculta {
                    isla_oculta = completa;
                    if let Some(w) = app.get_webview_window("isla") {
                        let _ = if completa { w.hide() } else { w.show() };
                    }
                }
            } else {
                isla_oculta = false;
            }
        }
    });
}

fn crear_bandeja(app: &AppHandle, fondo_inicial: bool) -> tauri::Result<()> {
    let abrir = MenuItem::with_id(app, "ventana", "Abrir en ventana", true, None::<&str>)?;
    let fondo = CheckMenuItem::with_id(app, "fondo", "Fondo de pantalla", true, fondo_inicial, None::<&str>)?;
    let isla = CheckMenuItem::with_id(app, "isla", "Isla dinámica", true, isla_guardada(app), None::<&str>)?;
    let inicio_activo = app.autolaunch().is_enabled().unwrap_or(false);
    let inicio = CheckMenuItem::with_id(app, "inicio", "Iniciar con Windows", true, inicio_activo, None::<&str>)?;
    let salir = MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?;
    let separador = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&abrir, &fondo, &isla, &inicio, &separador, &salir])?;

    let fondo_c = fondo.clone();
    let inicio_c = inicio.clone();
    let isla_c = isla.clone();
    let mut tray = TrayIconBuilder::with_id("aura").tooltip("Aura").menu(&menu);
    if let Some(icono) = app.default_window_icon() {
        tray = tray.icon(icono.clone());
    }
    tray.on_menu_event(move |app, evento| match evento.id().as_ref() {
        "ventana" => {
            let _ = poner_fondo(app, false);
            let _ = fondo_c.set_checked(false);
        }
        "fondo" => {
            let activar = fondo_c.is_checked().unwrap_or(false);
            if let Err(e) = poner_fondo(app, activar) {
                eprintln!("Fondo de pantalla: {e}");
                let _ = fondo_c.set_checked(false);
            }
        }
        "isla" => poner_isla(app, isla_c.is_checked().unwrap_or(true)),
        "inicio" => {
            let activar = inicio_c.is_checked().unwrap_or(false);
            let resultado = if activar { app.autolaunch().enable() } else { app.autolaunch().disable() };
            if resultado.is_err() {
                let _ = inicio_c.set_checked(!activar);
            }
        }
        "salir" => {
            if app.state::<ModoFondo>().0.load(Ordering::Relaxed) {
                fondo::refrescar_fondo();
            }
            app.exit(0);
        }
        _ => {}
    })
    .build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        // Al iniciar con Windows se abre directo como fondo de pantalla.
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--fondo"])))
        .setup(|app| {
            let tx = media::start(app.handle().clone());
            app.manage(MediaTx(Mutex::new(tx)));

            let activo = Arc::new(AtomicBool::new(true));
            audio::start(app.handle().clone(), activo.clone());
            app.manage(Visualizador(activo));

            let modo = Arc::new(AtomicBool::new(false));
            app.manage(ModoFondo(modo.clone()));
            let isla = Arc::new(AtomicBool::new(false));
            app.manage(IslaActiva(isla.clone()));
            vigilar_escritorio(app.handle().clone(), modo, isla);

            let handle = app.handle().clone();
            let arranque = std::env::args().any(|a| a == "--fondo") || modo_guardado(&handle);
            crear_bandeja(&handle, arranque)?;
            poner_isla(&handle, isla_guardada(&handle));

            if arranque {
                if let Err(e) = poner_fondo(&handle, true) {
                    eprintln!("Fondo de pantalla: {e}");
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.show();
                    }
                }
            } else if let Some(w) = handle.get_webview_window("main") {
                let _ = w.show();
            }
            Ok(())
        })
        // Cerrar la ventana principal solo la esconde: Aura sigue en la bandeja (y la isla también).
        .on_window_event(|ventana, evento| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = evento {
                if ventana.label() == "main" {
                    api.prevent_close();
                    let _ = ventana.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            media_control,
            select_source,
            get_lyrics,
            set_visualizer,
            wallpaper_mode,
            ask_ai,
            open_url,
            isla_tamano
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Aura");
}
