mod files;
mod process;
mod serial;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(serial::Ports::default())
        .manage(process::Processes::default())
        .invoke_handler(tauri::generate_handler![
            serial::serial_list,
            serial::serial_open,
            serial::serial_write,
            serial::serial_close,
            serial::serial_reset,
            process::process_spawn,
            process::process_kill,
            process::which,
            files::app_dir,
            files::list_dir,
            files::read_text_file,
            files::write_text_file,
            files::delete_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
