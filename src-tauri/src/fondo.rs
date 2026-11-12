//! Modo fondo de pantalla: mete la ventana de Aura detrás de los íconos del escritorio,
//! como hacen Wallpaper Engine o Lively. También detecta si una ventana tapa el escritorio
//! (juego en pantalla completa o ventana maximizada) para pausar los efectos y no gastar GPU.

#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetClassNameW, GetForegroundWindow, GetWindowRect,
        GetWindowLongPtrW, IsZoomed, SendMessageTimeoutW, SetParent, SetWindowLongPtrW, SetWindowPos,
        SystemParametersInfoW, GWL_EXSTYLE, GWL_STYLE, SMTO_NORMAL, SPI_GETDESKWALLPAPER,
        SPI_SETDESKWALLPAPER, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        SWP_SHOWWINDOW, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, WS_CAPTION, WS_EX_CLIENTEDGE,
        WS_EX_DLGMODALFRAME, WS_EX_STATICEDGE, WS_EX_WINDOWEDGE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
        WS_SYSMENU, WS_THICKFRAME,
    };
    use std::sync::atomic::{AtomicIsize, Ordering};

    /// Estilos originales de la ventana, para regresarlos al salir del modo fondo.
    static ESTILO: AtomicIsize = AtomicIsize::new(0);
    static ESTILO_EX: AtomicIsize = AtomicIsize::new(0);

    fn hwnd(raw: isize) -> HWND {
        HWND(raw as *mut c_void)
    }

    fn nulo() -> HWND {
        HWND(std::ptr::null_mut())
    }

    /// Busca el WorkerW que queda detrás de los íconos (Windows 10 y 11 hasta 23H2).
    unsafe extern "system" fn buscar_worker(h: HWND, lparam: LPARAM) -> BOOL {
        if FindWindowExW(h, nulo(), w!("SHELLDLL_DefView"), PCWSTR::null()).is_ok() {
            if let Ok(worker) = FindWindowExW(nulo(), h, w!("WorkerW"), PCWSTR::null()) {
                *(lparam.0 as *mut HWND) = worker;
            }
        }
        BOOL(1)
    }

    fn rect_monitor_principal() -> Option<RECT> {
        unsafe {
            let mon = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            GetMonitorInfoW(mon, &mut info).as_bool().then_some(info.rcMonitor)
        }
    }

    pub fn pegar(raw: isize) -> Result<(), String> {
        unsafe {
            let ventana = hwnd(raw);
            let progman = FindWindowW(w!("Progman"), PCWSTR::null()).map_err(|e| e.to_string())?;
            // Este mensaje le pide al escritorio que cree la capa detrás de los íconos.
            SendMessageTimeoutW(progman, 0x052C, WPARAM(0xD), LPARAM(0x1), SMTO_NORMAL, 1000, None);
            SendMessageTimeoutW(progman, 0x052C, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, None);

            let mut worker = nulo();
            let _ = EnumWindows(Some(buscar_worker), LPARAM(&mut worker as *mut HWND as isize));

            let (padre, debajo_de) = if !worker.0.is_null() {
                (worker, None)
            } else {
                // Windows 11 24H2 o más nuevo: la capa vive dentro de Progman, debajo de los íconos.
                let iconos = FindWindowExW(progman, nulo(), w!("SHELLDLL_DefView"), PCWSTR::null()).ok();
                (progman, iconos)
            };

            // Sin marco ni bordes invisibles de redimensionar: si no, quedan franjas a los lados.
            let estilo = GetWindowLongPtrW(ventana, GWL_STYLE);
            let estilo_ex = GetWindowLongPtrW(ventana, GWL_EXSTYLE);
            if ESTILO.load(Ordering::Relaxed) == 0 {
                ESTILO.store(estilo, Ordering::Relaxed);
                ESTILO_EX.store(estilo_ex, Ordering::Relaxed);
            }
            let quitar = (WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0) as isize;
            let quitar_ex = (WS_EX_DLGMODALFRAME.0 | WS_EX_CLIENTEDGE.0 | WS_EX_STATICEDGE.0 | WS_EX_WINDOWEDGE.0) as isize;
            SetWindowLongPtrW(ventana, GWL_STYLE, estilo & !quitar);
            SetWindowLongPtrW(ventana, GWL_EXSTYLE, estilo_ex & !quitar_ex);

            SetParent(ventana, padre).map_err(|e| e.to_string())?;

            let monitor = rect_monitor_principal().ok_or("no se encontró el monitor")?;
            let mut r_padre = RECT::default();
            GetWindowRect(padre, &mut r_padre).map_err(|e| e.to_string())?;
            let (x, y) = (monitor.left - r_padre.left, monitor.top - r_padre.top);
            let (ancho, alto) = (monitor.right - monitor.left, monitor.bottom - monitor.top);
            match debajo_de {
                Some(iconos) => SetWindowPos(ventana, iconos, x, y, ancho, alto, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED),
                None => SetWindowPos(ventana, nulo(), x, y, ancho, alto, SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED),
            }
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn despegar(raw: isize) {
        unsafe {
            let ventana = hwnd(raw);
            let _ = SetParent(ventana, nulo());
            let estilo = ESTILO.swap(0, Ordering::Relaxed);
            let estilo_ex = ESTILO_EX.swap(0, Ordering::Relaxed);
            if estilo != 0 {
                SetWindowLongPtrW(ventana, GWL_STYLE, estilo);
                SetWindowLongPtrW(ventana, GWL_EXSTYLE, estilo_ex);
                let _ = SetWindowPos(ventana, nulo(), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
            }
        }
        refrescar_fondo();
    }

    /// Vuelve a aplicar el fondo de Windows para que no se quede pegada la última imagen de Aura.
    pub fn refrescar_fondo() {
        unsafe {
            let mut ruta = [0u16; 260];
            let flags = SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0);
            if SystemParametersInfoW(SPI_GETDESKWALLPAPER, ruta.len() as u32, Some(ruta.as_mut_ptr() as *mut c_void), flags).is_ok() {
                let _ = SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, Some(ruta.as_mut_ptr() as *mut c_void), flags);
            }
        }
    }

    /// ¿Hay una ventana maximizada o en pantalla completa tapando el escritorio?
    pub fn tapado() -> bool {
        revisar(true)
    }

    /// ¿Hay algo en pantalla completa de verdad (un juego, un video)? Ahí se esconde la isla.
    pub fn pantalla_completa() -> bool {
        revisar(false)
    }

    fn revisar(contar_maximizadas: bool) -> bool {
        unsafe {
            let fg = GetForegroundWindow();
            if fg.0.is_null() {
                return false;
            }
            let mut clase = [0u16; 64];
            let n = GetClassNameW(fg, &mut clase).max(0) as usize;
            let clase = String::from_utf16_lossy(&clase[..n]);
            if matches!(clase.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
                return false;
            }
            if contar_maximizadas && IsZoomed(fg).as_bool() {
                return true;
            }
            let mut r = RECT::default();
            if GetWindowRect(fg, &mut r).is_err() {
                return false;
            }
            let mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if !GetMonitorInfoW(mon, &mut info).as_bool() {
                return false;
            }
            let m = info.rcMonitor;
            r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
        }
    }
}

#[cfg(windows)]
pub use win::{despegar, pantalla_completa, pegar, refrescar_fondo, tapado};

#[cfg(not(windows))]
pub fn pegar(_raw: isize) -> Result<(), String> {
    Err("el modo fondo de pantalla solo funciona en Windows".into())
}
#[cfg(not(windows))]
pub fn despegar(_raw: isize) {}
#[cfg(not(windows))]
pub fn refrescar_fondo() {}
#[cfg(not(windows))]
pub fn tapado() -> bool {
    false
}
#[cfg(not(windows))]
pub fn pantalla_completa() -> bool {
    false
}
