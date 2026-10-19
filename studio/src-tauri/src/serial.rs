//! USB serial access for the frontend. Each open port gets a reader thread that
//! streams received bytes to a Tauri channel.

use serde::Serialize;
use serialport::{SerialPort, SerialPortType};
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;

#[derive(Serialize)]
pub struct PortInfo {
    path: String,
    kind: String,
    vid: Option<u16>,
    pid: Option<u16>,
    serial_number: Option<String>,
    manufacturer: Option<String>,
    product: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "lowercase")]
pub enum SerialEvent {
    Data(Vec<u8>),
    Closed { reason: String },
}

struct OpenPort {
    port: Box<dyn SerialPort>,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Ports {
    next: AtomicU32,
    open: Mutex<HashMap<u32, OpenPort>>,
}

#[tauri::command]
pub fn serial_list() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| match p.port_type {
            SerialPortType::UsbPort(u) => PortInfo {
                path: p.port_name,
                kind: "usb".into(),
                vid: Some(u.vid),
                pid: Some(u.pid),
                serial_number: u.serial_number,
                manufacturer: u.manufacturer,
                product: u.product,
            },
            other => PortInfo {
                path: p.port_name,
                kind: match other {
                    SerialPortType::PciPort => "pci",
                    SerialPortType::BluetoothPort => "bluetooth",
                    _ => "unknown",
                }
                .into(),
                vid: None,
                pid: None,
                serial_number: None,
                manufacturer: None,
                product: None,
            },
        })
        .collect())
}

#[tauri::command]
pub fn serial_open(
    state: State<'_, Ports>,
    path: String,
    baud: u32,
    on_event: Channel<SerialEvent>,
) -> Result<u32, String> {
    let port = serialport::new(&path, baud)
        .timeout(Duration::from_millis(20))
        .open()
        .map_err(|e| format!("Could not open {path}: {e}"))?;
    let mut reader = port.try_clone().map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let id = state.next.fetch_add(1, Ordering::Relaxed);

    let stop_reader = stop.clone();
    thread::Builder::new()
        .name(format!("serial-rx-{id}"))
        .spawn(move || {
            let mut buf = [0u8; 4096];
            let reason = loop {
                if stop_reader.load(Ordering::Relaxed) {
                    break "closed".to_string();
                }
                match reader.read(&mut buf) {
                    Ok(0) => continue,
                    Ok(n) => {
                        if on_event.send(SerialEvent::Data(buf[..n].to_vec())).is_err() {
                            break "frontend went away".to_string();
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::TimedOut || e.kind() == ErrorKind::Interrupted => continue,
                    Err(e) => break e.to_string(),
                }
            };
            let _ = on_event.send(SerialEvent::Closed { reason });
        })
        .map_err(|e| e.to_string())?;

    state.open.lock().unwrap().insert(id, OpenPort { port, stop });
    Ok(id)
}

#[tauri::command]
pub fn serial_write(state: State<'_, Ports>, id: u32, data: Vec<u8>) -> Result<(), String> {
    let mut open = state.open.lock().unwrap();
    let p = open.get_mut(&id).ok_or("Port is not open")?;
    p.port.write_all(&data).map_err(|e| e.to_string())?;
    p.port.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn serial_close(state: State<'_, Ports>, id: u32) -> Result<(), String> {
    if let Some(p) = state.open.lock().unwrap().remove(&id) {
        p.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Pulse DTR. The JTAGulator's FT232R drives the Propeller's reset from DTR.
#[tauri::command]
pub fn serial_reset(state: State<'_, Ports>, id: u32) -> Result<(), String> {
    let mut open = state.open.lock().unwrap();
    let p = open.get_mut(&id).ok_or("Port is not open")?;
    p.port.write_data_terminal_ready(false).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(25));
    p.port.write_data_terminal_ready(true).map_err(|e| e.to_string())?;
    Ok(())
}
