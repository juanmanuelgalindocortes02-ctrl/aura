// Sin consola extra en la versión final de Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aura_lib::run()
}
