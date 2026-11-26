//! Letras desde LRCLIB (https://lrclib.net): gratis, sin clave y con letras sincronizadas.

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    /// Formato LRC: "[01:23.45] línea".
    pub synced: Option<String>,
    pub plain: Option<String>,
    pub instrumental: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Lrc {
    #[serde(default)]
    artist_name: String,
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
    #[serde(default)]
    instrumental: bool,
    duration: Option<f64>,
}

impl From<Lrc> for Lyrics {
    fn from(l: Lrc) -> Self {
        let lleno = |s: Option<String>| s.filter(|t| !t.trim().is_empty());
        Lyrics {
            synced: lleno(l.synced_lyrics),
            plain: lleno(l.plain_lyrics),
            instrumental: l.instrumental,
        }
    }
}

const API: &str = "https://lrclib.net/api";
const AGENTE: &str = "Aura/0.1 (reproductor personal)";

/// Minúsculas y sin acentos, para comparar "Canción" con "cancion".
fn normal(t: &str) -> String {
    t.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            otro => otro,
        })
        .collect()
}

/// Busca un corte sin importar mayúsculas y devuelve la posición en el texto original.
fn posicion(t: &str, corte: &str) -> Option<usize> {
    t.to_lowercase().find(corte).filter(|&i| t.is_char_boundary(i))
}

/// Quita "(feat. ...)", "ft. ...", "[...]", " - Remastered", "(Letra)"... para que la búsqueda acierte más.
fn limpiar(titulo: &str) -> String {
    let mut t = titulo.to_string();
    for corte in [
        " (feat", " (ft", " feat.", " feat ", " ft.", " ft ", " (with", " (con ", " [", " - ", " | ",
        " (letra", " (lyric", " (video", " (audio", " (official", " (oficial", " (en vivo", " (live",
    ] {
        if let Some(i) = posicion(&t, corte) {
            t.truncate(i);
        }
    }
    t.trim().trim_matches('"').trim().to_string()
}

/// Solo el primer artista: "A, B & C", "A x B", "A y B", "A ft. B" → "A".
fn principal(artista: &str) -> String {
    let mut a = artista.to_string();
    for corte in [",", " & ", " x ", " y ", " ft.", " ft ", " feat", " with ", " con "] {
        if let Some(i) = posicion(&a, corte) {
            a.truncate(i);
        }
    }
    a.trim().to_string()
}

fn exacta(artista: &str, titulo: &str, album: &str, segundos: i64) -> Option<Lrc> {
    ureq::get(&format!("{API}/get"))
        .set("User-Agent", AGENTE)
        .query("artist_name", artista)
        .query("track_name", titulo)
        .query("album_name", album)
        .query("duration", &segundos.to_string())
        .timeout(Duration::from_secs(10))
        .call()
        .ok()?
        .into_json()
        .ok()
}

fn buscar_lista(artista: &str, titulo: &str) -> Vec<Lrc> {
    ureq::get(&format!("{API}/search"))
        .set("User-Agent", AGENTE)
        .query("artist_name", artista)
        .query("track_name", titulo)
        .timeout(Duration::from_secs(10))
        .call()
        .ok()
        .and_then(|r| r.into_json().ok())
        .unwrap_or_default()
}

/// Búsqueda libre ("artista canción" en un solo texto): perdona acentos y nombres escritos distinto.
fn buscar_libre(texto: &str) -> Vec<Lrc> {
    ureq::get(&format!("{API}/search"))
        .set("User-Agent", AGENTE)
        .query("q", texto)
        .timeout(Duration::from_secs(10))
        .call()
        .ok()
        .and_then(|r| r.into_json().ok())
        .unwrap_or_default()
}

pub fn buscar(artista: &str, titulo: &str, album: &str, duracion_ms: i64) -> Lyrics {
    let segundos = (duracion_ms as f64 / 1000.0).round() as i64;

    // 1) Coincidencia exacta (necesita duración).
    if segundos > 0 {
        if let Some(l) = exacta(artista, titulo, album, segundos) {
            if l.synced_lyrics.is_some() || l.instrumental {
                return l.into();
            }
        }
    }

    // 2) Varias búsquedas, de la más precisa a la más amplia. Las canciones en español suelen
    //    venir como "A x B", "ft." o con acentos distintos, por eso se prueba de varias formas.
    let art = principal(artista);
    let tit = limpiar(titulo);
    let mut lista = buscar_lista(&art, &tit);
    if !lista.iter().any(|l| l.synced_lyrics.is_some()) {
        lista.extend(buscar_libre(&format!("{art} {tit}")));
    }
    if !lista.iter().any(|l| l.synced_lyrics.is_some()) {
        // Solo por título, y luego se revisa que el artista se parezca.
        let artista_n = normal(&art);
        lista.extend(buscar_libre(&tit).into_iter().filter(|l| {
            let otro = normal(&l.artist_name);
            !artista_n.is_empty() && !otro.is_empty() && (otro.contains(&artista_n) || artista_n.contains(&otro))
        }));
    }

    let diferencia = |l: &Lrc| match (l.duration, segundos) {
        (Some(d), s) if s > 0 => (d - s as f64).abs(),
        _ => 0.0,
    };
    // Gana la sincronizada con la duración más parecida. Los videos de YouTube suelen durar
    // más que la canción (intro, final), así que se aceptan hasta 20 s de diferencia.
    lista.retain(|l| segundos == 0 || diferencia(l) <= 20.0);
    lista.sort_by(|a, b| {
        b.synced_lyrics
            .is_some()
            .cmp(&a.synced_lyrics.is_some())
            .then(diferencia(a).total_cmp(&diferencia(b)))
    });
    lista.into_iter().next().map(Into::into).unwrap_or_default()
}
