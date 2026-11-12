//! IA local con Ollama (https://ollama.com): gratis, privada y sin internet.
//! El modelo contesta en JSON con su respuesta y, si hace falta, acciones para Aura
//! (pausar, cambiar escena, buscar una canción...).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

/// Modelo por defecto: chico, bueno en español y cabe en una GPU de 4 GB.
/// Se puede cambiar con la variable de entorno AURA_MODELO.
const MODELO: &str = "qwen2.5:3b";
const OLLAMA: &str = "http://localhost:11434/api/chat";

#[derive(Deserialize, Serialize, Clone)]
pub struct Mensaje {
    pub role: String,
    pub content: String,
}

const PERSONALIDAD: &str = "Eres Aura, la compañera musical que vive dentro de un reproductor de música en la computadora del usuario. \
Hablas en español de México, casual, buena onda y breve (2 a 4 frases, sin listas largas). \
Sabes mucho de música: géneros, artistas, historia y recomendaciones. \
Recibes el contexto de lo que está sonando; úsalo cuando ayude, sin repetirlo todo. \
Si te preguntan de qué trata una canción, explícalo con tus palabras; nunca copies la letra completa ni versos largos. \
Puedes controlar el reproductor agregando acciones: \
pausa (pausar o reanudar), siguiente, anterior, \
escena con valor cintas | synthwave | laser | anillo (efectos visuales), \
efectos con valor completo | ligero | apagado, \
vista con valor letra | constelacion | carrusel | normal (constelacion es la letra palabra por palabra como estrellas), \
buscar con valor 'artista canción' (abre la búsqueda para ponerla). \
Solo agrega acciones cuando el usuario lo pida o claramente lo quiera; si no, deja la lista vacía. \
Si recomiendas varias canciones, menciónalas en la respuesta y agrega como mucho una acción buscar con la principal.";

fn esquema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "respuesta": { "type": "string" },
            "acciones": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "tipo": {
                            "type": "string",
                            "enum": ["pausa", "siguiente", "anterior", "escena", "efectos", "vista", "buscar"]
                        },
                        "valor": { "type": "string" }
                    },
                    "required": ["tipo"]
                }
            }
        },
        "required": ["respuesta", "acciones"]
    })
}

pub fn preguntar(mensajes: Vec<Mensaje>, contexto: String) -> Result<Value, String> {
    let modelo = std::env::var("AURA_MODELO").unwrap_or_else(|_| MODELO.to_string());
    let mut todos = vec![
        json!({ "role": "system", "content": PERSONALIDAD }),
        json!({ "role": "system", "content": format!("Contexto actual:\n{contexto}") }),
    ];
    // Solo los últimos mensajes: el modelo es chico y así responde más rápido.
    let inicio = mensajes.len().saturating_sub(12);
    for m in &mensajes[inicio..] {
        todos.push(json!({ "role": &m.role, "content": &m.content }));
    }

    let resp = ureq::post(OLLAMA)
        .timeout(Duration::from_secs(120))
        .send_json(json!({
            "model": modelo,
            "messages": todos,
            "stream": false,
            "format": esquema(),
            "options": { "temperature": 0.7 }
        }));

    let cuerpo: Value = match resp {
        Ok(r) => r.into_json().map_err(|e| e.to_string())?,
        Err(ureq::Error::Status(404, _)) => {
            return Err(format!("Falta descargar el modelo. Abre una terminal y corre: ollama pull {modelo}"))
        }
        Err(ureq::Error::Status(c, r)) => {
            return Err(format!("Ollama respondió con error {c}: {}", r.into_string().unwrap_or_default()))
        }
        Err(_) => {
            return Err("No encuentro a Ollama. Instálalo desde ollama.com y revisa que esté abierto.".into())
        }
    };

    let texto = cuerpo["message"]["content"].as_str().unwrap_or_default();
    serde_json::from_str::<Value>(texto)
        .or_else(|_| Ok(json!({ "respuesta": texto, "acciones": [] })))
}
