// HF Field Antenna Calculator — Desktop Shell
// ─────────────────────────────────────────────
// Original work of Cpl Angeles-Gonzalez, Ezekiel S. — USMC
// Project signature: HFCALC-AG-EZK-USMC-v1
// Released under CC BY-NC-ND 4.0
//
// This Rust program wraps the web-based HF Field Antenna Calculator in a
// native Windows desktop window using Tauri + WebView2. The calculator
// itself, all calculation logic, and the AI integration layer are
// implemented in JavaScript inside the bundled web app (../dist).

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Error launching HF Field Antenna desktop app");
}
