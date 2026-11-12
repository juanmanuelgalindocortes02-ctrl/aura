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

/// Quita "(feat. ...)", "[...]" y " - Remastered" para que la búsqueda acierte más.
fn limpiar(titulo: &str) -> String {
    let mut t = titulo;
    for corte in [" (feat", " (with", " [", " - "] {
        if let Some(i) = t.find(corte) {
            t = &t[..i];
        }
    }
    t.trim().to_string()
}

/// Solo el primer artista: "A, B & C" → "A".
fn principal(artista: &str) -> String {
    artista
        .split([',', '&'])
        .next()
        .unwrap_or(artista)
        .trim()
        .to_string()
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

    // 2) Búsqueda libre con el título limpio; gana la sincronizada con duración más parecida.
    let mut lista = buscar_lista(&principal(artista), &limpiar(titulo));
    if lista.is_empty() {
        lista = buscar_lista(artista, titulo);
    }
    let diferencia = |l: &Lrc| match (l.duration, segundos) {
        (Some(d), s) if s > 0 => (d - s as f64).abs(),
        _ => 0.0,
    };
    lista.retain(|l| segundos == 0 || diferencia(l) <= 5.0);
    lista.sort_by(|a, b| {
        b.synced_lyrics
            .is_some()
            .cmp(&a.synced_lyrics.is_some())
            .then(diferencia(a).total_cmp(&diferencia(b)))
    });
    lista.into_iter().next().map(Into::into).unwrap_or_default()
}
