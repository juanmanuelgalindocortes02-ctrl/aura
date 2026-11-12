//! Lectura y control de lo que suena en Windows.
//!
//! Windows registra cada app de música (Spotify, Apple Music, Chrome con YouTube Music…)
//! como una "sesión multimedia" (SMTC). Aquí las listamos, elegimos una y mandamos su estado
//! a la interfaz cada medio segundo con el evento `media://state`.

use serde::Serialize;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub enum Cmd {
    Toggle,
    Next,
    Prev,
    Seek(i64),
    Select(String),
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub status: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub source_id: String,
    pub source_name: String,
    pub source_kind: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover: Option<String>,
    pub playing: bool,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub can_prev: bool,
    pub can_next: bool,
    pub can_seek: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub selected: String,
    pub sources: Vec<Source>,
    pub now: Option<NowPlaying>,
}

const INTERVALO: Duration = Duration::from_millis(500);

pub fn start(app: AppHandle) -> Sender<Cmd> {
    let (tx, rx) = channel();
    std::thread::spawn(move || imp::run(app, rx));
    tx
}

/// Nombre legible y tipo de una sesión a partir de su identificador de app.
fn describe(id: &str) -> (String, String) {
    let l = id.to_lowercase();
    let par = |n: &str, k: &str| (n.to_string(), k.to_string());
    if l.contains("spotify") {
        par("Spotify", "spotify")
    } else if l.contains("applemusic") || l.contains("appleinc") {
        par("Apple Music", "apple")
    } else if l.contains("amazon") {
        par("Amazon Music", "amazon")
    } else if l.contains("chrome") {
        par("Chrome (web)", "web")
    } else if l.contains("msedge") || l.contains("edge") {
        par("Edge (web)", "web")
    } else if l.contains("firefox") {
        par("Firefox (web)", "web")
    } else if l.contains("brave") {
        par("Brave (web)", "web")
    } else if l.contains("opera") {
        par("Opera (web)", "web")
    } else if l.contains("zunemusic") || l.contains("mediaplayer") {
        par("Reproductor multimedia", "windows")
    } else {
        let limpio = id.split('!').next().unwrap_or(id).trim_end_matches(".exe");
        let corto = limpio.rsplit('\\').next().unwrap_or(limpio);
        par(if corto.is_empty() { "App desconocida" } else { corto }, "other")
    }
}

/// Los videos de YouTube traen títulos como "Artista - Canción (Video Oficial) [HD]"
/// y el canal como artista ("ArtistaVEVO", "Artista - Topic"). Esto los deja limpios.
fn limpiar_web(titulo: &str, artista: &str) -> (String, String) {
    const RUIDO: [&str; 14] = [
        "official", "oficial", "video", "vídeo", "audio", "lyric", "letra", "visualizer",
        "hd", "4k", "mv", "remaster", "en vivo", "live",
    ];
    // Quita [...] siempre y (...) cuando es ruido.
    let mut t = String::new();
    let mut resto = titulo;
    while let Some(i) = resto.find(['(', '[']) {
        t.push_str(&resto[..i]);
        let cierre = if resto[i..].starts_with('(') { ')' } else { ']' };
        match resto[i..].find(cierre) {
            Some(j) => {
                let dentro = &resto[i..i + j + 1];
                let es_ruido = cierre == ']' || RUIDO.iter().any(|r| dentro.to_lowercase().contains(r));
                if !es_ruido {
                    t.push_str(dentro);
                }
                resto = &resto[i + j + 1..];
            }
            None => {
                resto = &resto[i..];
                break;
            }
        }
    }
    t.push_str(resto);
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");

    let mut a = artista.trim().trim_end_matches(" - Topic").to_string();
    if a.to_uppercase().ends_with("VEVO") && a.len() > 4 {
        a.truncate(a.len() - 4);
    }

    // "Artista - Canción": el artista del título es más confiable que el nombre del canal.
    for sep in [" - ", " – ", " — ", " | "] {
        if let Some((izq, der)) = t.split_once(sep) {
            if !izq.trim().is_empty() && !der.trim().is_empty() {
                return (der.trim().to_string(), izq.trim().to_string());
            }
        }
    }
    (t, a.trim().to_string())
}

/// Busca la portada en el catálogo de iTunes (gratis, sin clave) cuando la app no la manda.
/// Prueba varias búsquedas, de la más precisa a la más amplia.
fn buscar_portada_web(artista: &str, titulo: &str, album: &str) -> Option<String> {
    // Sin "(feat. ...)", "[...]" ni " - Remastered" la búsqueda acierta más.
    let mut limpio = titulo;
    for corte in [" (feat", " (with", " [", " - "] {
        if let Some(i) = limpio.find(corte) {
            limpio = &limpio[..i];
        }
    }
    let intentos = [
        (format!("{artista} {limpio}"), "song", "mx"),
        (format!("{artista} {limpio}"), "song", "us"),
        (format!("{artista} {album}"), "album", "mx"),
        (format!("{artista} {album}"), "album", "us"),
    ];
    for (termino, tipo, pais) in intentos {
        if termino.trim().len() < 3 {
            continue;
        }
        let resp: Option<serde_json::Value> = ureq::get("https://itunes.apple.com/search")
            .query("term", termino.trim())
            .query("entity", tipo)
            .query("limit", "1")
            .query("country", pais)
            .timeout(Duration::from_secs(8))
            .call()
            .ok()
            .and_then(|r| r.into_json().ok());
        if let Some(url) = resp.as_ref().and_then(|r| r["results"][0]["artworkUrl100"].as_str()) {
            return Some(url.replace("100x100bb", "600x600bb"));
        }
    }
    None
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    /// Fuera de Windows no hay SMTC: la interfaz muestra el estado vacío.
    pub fn run(app: AppHandle, rx: Receiver<Cmd>) {
        let mut selected = String::from("auto");
        loop {
            match rx.recv_timeout(INTERVALO) {
                Ok(Cmd::Select(id)) => selected = id,
                Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            let _ = app.emit(
                "media://state",
                Snapshot { selected: selected.clone(), sources: vec![], now: None },
            );
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use base64::Engine;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::time::{Instant, SystemTime, UNIX_EPOCH};
    use windows::core::Result;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Props,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::{DataReader, InputStreamOptions};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    /// Portadas de internet por canción.
    enum Busqueda {
        Pendiente,
        Lista(String),
        /// Falló; se reintenta pasado un rato (por si fue internet o límite de iTunes).
        Fallo(Instant),
    }
    type Web = Arc<Mutex<HashMap<String, Busqueda>>>;
    const REINTENTO: Duration = Duration::from_secs(30);

    /// Windows mide el tiempo en unidades de 100 ns.
    const TICKS_POR_MS: i64 = 10_000;
    /// Diferencia entre 1601 (época de Windows) y 1970 (época Unix) en unidades de 100 ns.
    const EPOCA_WINDOWS: i64 = 116_444_736_000_000_000;

    pub fn run(app: AppHandle, rx: Receiver<Cmd>) {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let manager = loop {
            match Manager::RequestAsync().and_then(|op| op.get()) {
                Ok(m) => break m,
                Err(_) => std::thread::sleep(Duration::from_secs(2)),
            }
        };

        let mut selected = String::from("auto");
        let mut portadas: HashMap<String, String> = HashMap::new();
        let web: Web = Arc::default();

        loop {
            match rx.recv_timeout(INTERVALO) {
                Ok(Cmd::Select(id)) => selected = id,
                Ok(cmd) => {
                    if let Some(s) = pick(&manager, &selected) {
                        let _ = control(&s, cmd);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            let _ = app.emit("media://state", snapshot(&manager, &selected, &mut portadas, &web));
        }
    }

    fn aumid(s: &Session) -> String {
        s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default()
    }

    fn sessions(m: &Manager) -> Vec<Session> {
        let Ok(lista) = m.GetSessions() else { return vec![] };
        let n = lista.Size().unwrap_or(0);
        (0..n).filter_map(|i| lista.GetAt(i).ok()).collect()
    }

    /// La sesión elegida; si no existe o es "auto", la que Windows considera actual.
    fn pick(m: &Manager, selected: &str) -> Option<Session> {
        if selected != "auto" {
            if let Some(s) = sessions(m).into_iter().find(|s| aumid(s) == selected) {
                return Some(s);
            }
        }
        m.GetCurrentSession().ok()
    }

    fn control(s: &Session, cmd: Cmd) -> Result<()> {
        match cmd {
            Cmd::Toggle => {
                s.TryTogglePlayPauseAsync()?.get()?;
            }
            Cmd::Next => {
                s.TrySkipNextAsync()?.get()?;
            }
            Cmd::Prev => {
                s.TrySkipPreviousAsync()?.get()?;
            }
            Cmd::Seek(ms) => {
                s.TryChangePlaybackPositionAsync(ms * TICKS_POR_MS)?.get()?;
            }
            Cmd::Select(_) => {}
        }
        Ok(())
    }

    fn estado(s: &Session) -> Option<Status> {
        s.GetPlaybackInfo().ok()?.PlaybackStatus().ok()
    }

    fn snapshot(m: &Manager, selected: &str, portadas: &mut HashMap<String, String>, web: &Web) -> Snapshot {
        let sources = sessions(m)
            .iter()
            .map(|s| {
                let id = aumid(s);
                let (name, kind) = describe(&id);
                let status = match estado(s) {
                    Some(Status::Playing) => "Sonando ahora",
                    Some(Status::Paused) => "En pausa",
                    _ => "Abierta",
                };
                Source { id, name, kind, status: status.into() }
            })
            .collect();
        let now = pick(m, selected).and_then(|s| now_playing(&s, portadas, web).ok());
        Snapshot { selected: selected.to_string(), sources, now }
    }

    /// Devuelve la portada de internet si ya está; si no, lanza la búsqueda en otro hilo
    /// para no frenar la lectura de Windows.
    fn portada_web(web: &Web, artista: &str, titulo: &str, album: &str) -> Option<String> {
        if artista.is_empty() && titulo.is_empty() {
            return None;
        }
        let clave = format!("{artista}|{titulo}");
        let mut mapa = web.lock().ok()?;
        match mapa.get(&clave) {
            Some(Busqueda::Lista(url)) => return Some(url.clone()),
            Some(Busqueda::Pendiente) => return None,
            Some(Busqueda::Fallo(cuando)) if cuando.elapsed() < REINTENTO => return None,
            _ => {}
        }
        if mapa.len() > 200 {
            mapa.clear();
        }
        mapa.insert(clave.clone(), Busqueda::Pendiente);
        let web = web.clone();
        let (a, t, al) = (artista.to_string(), titulo.to_string(), album.to_string());
        std::thread::spawn(move || {
            let resultado = match buscar_portada_web(&a, &t, &al) {
                Some(url) => Busqueda::Lista(url),
                None => Busqueda::Fallo(Instant::now()),
            };
            if let Ok(mut m) = web.lock() {
                m.insert(clave, resultado);
            }
        });
        None
    }

    /// Apple Music manda "Artista — Álbum" en el campo de artista y deja el álbum vacío.
    fn separar_artista(artista: String, album: String) -> (String, String) {
        if album.trim().is_empty() {
            if let Some((a, b)) = artista.split_once(" — ") {
                return (a.trim().to_string(), b.trim().to_string());
            }
        }
        (artista, album)
    }

    fn ahora_en_ticks() -> i64 {
        let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        (d.as_nanos() / 100) as i64 + EPOCA_WINDOWS
    }

    fn now_playing(s: &Session, portadas: &mut HashMap<String, String>, web: &Web) -> Result<NowPlaying> {
        let id = aumid(s);
        let (source_name, source_kind) = describe(&id);

        let props = s.TryGetMediaPropertiesAsync()?.get()?;
        let title = props.Title()?.to_string();
        let (artist, album) = separar_artista(
            props.Artist()?.to_string(),
            props.AlbumTitle()?.to_string(),
        );
        let (title, artist) = if source_kind == "web" {
            limpiar_web(&title, &artist)
        } else {
            (title, artist)
        };

        // La portada solo se lee una vez por canción. Si la app aún no la manda, se reintenta.
        let clave = format!("{id}|{title}|{artist}");
        let cover = match portadas.get(&clave) {
            Some(c) => Some(c.clone()),
            None => {
                let c = leer_portada(&props);
                if let Some(c) = &c {
                    if portadas.len() > 40 {
                        portadas.clear();
                    }
                    portadas.insert(clave, c.clone());
                }
                c
            }
        };
        // En la web la miniatura es la del video (baja calidad): se prefiere la portada real.
        let cover = if source_kind == "web" {
            portada_web(web, &artist, &title, &album).or(cover)
        } else {
            cover.or_else(|| portada_web(web, &artist, &title, &album))
        };

        let info = s.GetPlaybackInfo()?;
        let playing = info.PlaybackStatus()? == Status::Playing;
        let ctrl = info.Controls()?;

        // Algunas apps (Spotify) actualizan la posición pocas veces; se adelanta con la hora.
        let tl = s.GetTimelineProperties()?;
        let inicio = tl.StartTime()?.Duration;
        let fin = tl.EndTime()?.Duration;
        let mut pos = tl.Position()?.Duration - inicio;
        let ultima = tl.LastUpdatedTime()?.UniversalTime;
        if playing && ultima > 0 {
            pos += (ahora_en_ticks() - ultima).max(0);
        }
        let dur = (fin - inicio).max(0);
        if dur > 0 {
            pos = pos.min(dur);
        }

        Ok(NowPlaying {
            source_id: id,
            source_name,
            source_kind,
            title,
            artist,
            album,
            cover,
            playing,
            position_ms: pos.max(0) / TICKS_POR_MS,
            duration_ms: dur / TICKS_POR_MS,
            can_prev: ctrl.IsPreviousEnabled().unwrap_or(true),
            can_next: ctrl.IsNextEnabled().unwrap_or(true),
            can_seek: ctrl.IsPlaybackPositionEnabled().unwrap_or(false) && dur > 0,
        })
    }

    /// Lee la miniatura de la sesión y la devuelve como data URL para usarla en un <img>.
    /// Se lee por bloques porque algunas apps (Apple Music) reportan tamaño 0 en el stream.
    fn leer_portada(props: &Props) -> Option<String> {
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.SetInputStreamOptions(InputStreamOptions::ReadAhead).ok()?;
        let mut buf: Vec<u8> = Vec::new();
        loop {
            let n = reader.LoadAsync(64 * 1024).ok()?.get().ok()?;
            if n == 0 {
                break;
            }
            let mut bloque = vec![0u8; n as usize];
            reader.ReadBytes(&mut bloque).ok()?;
            buf.extend_from_slice(&bloque);
            if buf.len() > 8_000_000 {
                break;
            }
        }
        if buf.len() < 100 {
            return None;
        }
        // El tipo se detecta por los primeros bytes; el que reportan las apps no es confiable.
        let mime = if buf.starts_with(&[0x89, b'P', b'N', b'G']) {
            "image/png"
        } else if buf.starts_with(b"RIFF") {
            "image/webp"
        } else {
            "image/jpeg"
        };
        let datos = base64::engine::general_purpose::STANDARD.encode(&buf);
        Some(format!("data:{mime};base64,{datos}"))
    }
}
