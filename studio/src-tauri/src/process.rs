//! Runs external tools (OpenOCD, GDB) and streams their output to the frontend.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "lowercase")]
pub enum ProcessEvent {
    Stdout(String),
    Stderr(String),
    Exit { code: Option<i32> },
}

#[derive(Default)]
pub struct Processes {
    next: AtomicU32,
    running: Mutex<HashMap<u32, Arc<Mutex<Child>>>>,
    stdin: Mutex<HashMap<u32, ChildStdin>>,
}

fn pump(stream: impl Read + Send + 'static, ch: Channel<ProcessEvent>, err: bool) {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            let Ok(line) = line else { break };
            let ev = if err { ProcessEvent::Stderr(line) } else { ProcessEvent::Stdout(line) };
            if ch.send(ev).is_err() {
                break;
            }
        }
    });
}

/// Only these programs can be started from the UI.
const ALLOWED: &[&str] = &["openocd", "gdb-multiarch", "arm-none-eabi-gdb", "gdb"];

#[tauri::command]
pub fn process_spawn(
    state: State<'_, Processes>,
    program: String,
    args: Vec<String>,
    interactive: Option<bool>,
    on_event: Channel<ProcessEvent>,
) -> Result<u32, String> {
    let name = std::path::Path::new(&program)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    if !ALLOWED.contains(&name.as_str()) {
        return Err(format!("{program} is not an allowed program"));
    }
    let mut child = Command::new(&program)
        .args(&args)
        .stdin(if interactive.unwrap_or(false) { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start {program}: {e}"))?;
    pump(child.stdout.take().unwrap(), on_event.clone(), false);
    pump(child.stderr.take().unwrap(), on_event.clone(), true);

    let id = state.next.fetch_add(1, Ordering::Relaxed);
    if let Some(stdin) = child.stdin.take() {
        state.stdin.lock().unwrap().insert(id, stdin);
    }
    let child = Arc::new(Mutex::new(child));
    state.running.lock().unwrap().insert(id, child.clone());
    thread::spawn(move || loop {
        let status = child.lock().unwrap().try_wait();
        match status {
            Ok(Some(s)) => {
                let _ = on_event.send(ProcessEvent::Exit { code: s.code() });
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => {
                let _ = on_event.send(ProcessEvent::Exit { code: None });
                break;
            }
        }
    });
    Ok(id)
}

/// Send text to an interactive process's standard input.
#[tauri::command]
pub fn process_write(state: State<'_, Processes>, id: u32, data: String) -> Result<(), String> {
    let mut map = state.stdin.lock().unwrap();
    let stdin = map.get_mut(&id).ok_or("The process has no input (or has exited)")?;
    stdin
        .write_all(data.as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("Could not write to the process: {e}"))
}

#[tauri::command]
pub fn process_kill(state: State<'_, Processes>, id: u32) -> Result<(), String> {
    state.stdin.lock().unwrap().remove(&id);
    if let Some(c) = state.running.lock().unwrap().remove(&id) {
        let _ = c.lock().unwrap().kill();
    }
    Ok(())
}

/// Locate a program on PATH.
#[tauri::command]
pub fn which(program: String) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        let p = dir.join(&program);
        let exe = if cfg!(windows) { p.with_extension("exe") } else { p.clone() };
        [p, exe].into_iter().find(|c| c.is_file()).map(|c| c.to_string_lossy().into_owned())
    })
}
