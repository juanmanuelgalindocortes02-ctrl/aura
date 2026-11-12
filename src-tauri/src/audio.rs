//! Escucha lo que suena en la compu (captura "loopback" de Windows) y lo convierte en
//! energía por bandas para los efectos: graves, medios, agudos, espectro, golpes y drops.
//! Funciona con cualquier app porque escucha la salida de audio, no a una app en particular.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const N: usize = 2048; // muestras por análisis (~43 ms a 48 kHz)
const BARRAS: usize = 32;
const CADA: Duration = Duration::from_millis(20); // 50 veces por segundo

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Bandas {
    bass: f32,
    mid: f32,
    high: f32,
    level: f32,
    beat: bool,
    drop: bool,
    spectrum: Vec<f32>,
}

/// Arranca la escucha en su propio hilo. Si el audio falla o cambias de salida
/// (por ejemplo, conectas audífonos), se vuelve a conectar sola.
pub fn start(app: AppHandle, activo: Arc<AtomicBool>) {
    std::thread::spawn(move || loop {
        if let Err(e) = escuchar(&app, &activo) {
            eprintln!("Audio: {e}");
        }
        std::thread::sleep(Duration::from_secs(2));
    });
}

fn empujar<T: Copy>(buffer: &Mutex<Vec<f32>>, datos: &[T], canales: usize, a_f32: impl Fn(T) -> f32) {
    let Ok(mut v) = buffer.lock() else { return };
    for cuadro in datos.chunks(canales.max(1)) {
        let mono = cuadro.iter().map(|&x| a_f32(x)).sum::<f32>() / cuadro.len() as f32;
        v.push(mono);
    }
    let largo = v.len();
    if largo > N * 4 {
        v.drain(..largo - N * 2);
    }
}

/// Seguidor con subida rápida y bajada lenta: se ve "golpeado" y no parpadea.
fn seguir(actual: f32, nuevo: f32) -> f32 {
    if nuevo > actual { actual * 0.4 + nuevo * 0.6 } else { actual * 0.85 + nuevo * 0.15 }
}

fn escuchar(app: &AppHandle, activo: &AtomicBool) -> Result<(), String> {
    let host = cpal::default_host();
    let salida = host.default_output_device().ok_or("no hay salida de audio")?;
    let nombre = salida.name().unwrap_or_default();
    let config = salida.default_output_config().map_err(|e| e.to_string())?;
    let canales = config.channels() as usize;
    let tasa = config.sample_rate().0 as f32;
    let stream_config: cpal::StreamConfig = config.clone().into();

    let buffer = Arc::new(Mutex::new(Vec::<f32>::with_capacity(N * 4)));
    let fallo = Arc::new(AtomicBool::new(false));
    let al_fallar = {
        let f = fallo.clone();
        move |e: cpal::StreamError| {
            eprintln!("Audio: {e}");
            f.store(true, Ordering::Relaxed);
        }
    };

    // En Windows, abrir una entrada sobre el dispositivo de salida activa el loopback.
    let b = buffer.clone();
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => salida.build_input_stream(
            &stream_config,
            move |d: &[f32], _: &_| empujar(&b, d, canales, |x| x),
            al_fallar,
            None,
        ),
        cpal::SampleFormat::I16 => salida.build_input_stream(
            &stream_config,
            move |d: &[i16], _: &_| empujar(&b, d, canales, |x| x as f32 / 32768.0),
            al_fallar,
            None,
        ),
        cpal::SampleFormat::I32 => salida.build_input_stream(
            &stream_config,
            move |d: &[i32], _: &_| empujar(&b, d, canales, |x| x as f32 / 2_147_483_648.0),
            al_fallar,
            None,
        ),
        otro => return Err(format!("formato de audio no soportado: {otro:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;

    let fft = FftPlanner::<f32>::new().plan_fft_forward(N);
    let ventana: Vec<f32> = (0..N)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (N - 1) as f32).cos())
        .collect();

    // Ganancia automática por banda: así se ve igual de vivo con volumen alto o bajo.
    let mut maximos = [1.0f32; 3 + BARRAS];
    let mut suave = [0.0f32; 3 + BARRAS];
    let mut promedio_graves = 0.0f32;
    let mut ultimo_golpe = Instant::now();
    let (mut nivel_corto, mut nivel_largo) = (0.0f32, 0.0f32);
    let mut ultimo_drop = Instant::now();
    let mut revision = Instant::now();

    loop {
        std::thread::sleep(CADA);
        if fallo.load(Ordering::Relaxed) {
            return Err("se perdió el dispositivo de audio".into());
        }
        // ¿Cambiaste de salida (bocinas ↔ audífonos)? Entonces se reconecta.
        if revision.elapsed() > Duration::from_secs(2) {
            revision = Instant::now();
            let actual = host.default_output_device().and_then(|d| d.name().ok());
            if actual.as_deref() != Some(nombre.as_str()) {
                return Ok(());
            }
        }
        if !activo.load(Ordering::Relaxed) {
            continue;
        }

        let muestras: Vec<f32> = {
            let Ok(v) = buffer.lock() else { continue };
            if v.len() < N {
                continue;
            }
            v[v.len() - N..].to_vec()
        };

        let rms = (muestras.iter().map(|x| x * x).sum::<f32>() / N as f32).sqrt();
        let silencio = rms < 0.002;

        let mut datos: Vec<Complex<f32>> = muestras
            .iter()
            .zip(&ventana)
            .map(|(m, w)| Complex::new(m * w, 0.0))
            .collect();
        fft.process(&mut datos);
        let mags: Vec<f32> = datos[..N / 2].iter().map(|c| c.norm()).collect();

        let indice = |f: f32| ((f / tasa * N as f32) as usize).clamp(1, N / 2 - 1);
        let energia = |a: f32, b: f32| {
            let i = indice(a);
            let j = indice(b).max(i + 1);
            mags[i..j].iter().sum::<f32>() / (j - i) as f32
        };

        let mut crudo = [0.0f32; 3 + BARRAS];
        crudo[0] = energia(20.0, 150.0);
        crudo[1] = energia(150.0, 2000.0);
        crudo[2] = energia(2000.0, 10000.0);
        for k in 0..BARRAS {
            // Barras en escala logarítmica de 40 Hz a 12 kHz, como las oye el oído.
            let f0 = 40.0 * 300f32.powf(k as f32 / BARRAS as f32);
            let f1 = 40.0 * 300f32.powf((k + 1) as f32 / BARRAS as f32);
            crudo[3 + k] = energia(f0, f1);
        }

        let mut normal = [0.0f32; 3 + BARRAS];
        for k in 0..normal.len() {
            maximos[k] = (maximos[k] * 0.997).max(crudo[k]).max(0.5);
            let v = if silencio { 0.0 } else { (crudo[k] / maximos[k]).clamp(0.0, 1.0).sqrt() };
            normal[k] = v;
            suave[k] = seguir(suave[k], v);
        }

        // Golpe: los graves saltan claramente sobre su promedio reciente.
        promedio_graves = promedio_graves * 0.94 + normal[0] * 0.06;
        let beat = !silencio
            && normal[0] > 0.45
            && normal[0] > promedio_graves * 1.3
            && ultimo_golpe.elapsed() > Duration::from_millis(180);
        if beat {
            ultimo_golpe = Instant::now();
        }

        // Drop: el volumen de golpe sube mucho después de una parte más tranquila.
        nivel_corto = nivel_corto * 0.7 + rms * 0.3;
        nivel_largo = nivel_largo * 0.995 + rms * 0.005;
        let drop = nivel_corto > nivel_largo * 1.8
            && rms > 0.05
            && ultimo_drop.elapsed() > Duration::from_secs(4);
        if drop {
            ultimo_drop = Instant::now();
        }

        let _ = app.emit(
            "audio://bands",
            Bandas {
                bass: suave[0],
                mid: suave[1],
                high: suave[2],
                level: (rms * 4.0).min(1.0),
                beat,
                drop,
                spectrum: suave[3..].to_vec(),
            },
        );
    }
}
