//! Computador: o binário só arranca a aplicação, que vive em `lib.rs` (partilhada com o Android).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lissecurity_lib::run()
}
