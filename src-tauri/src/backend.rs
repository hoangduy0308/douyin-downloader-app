use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

#[derive(Clone, Debug, Serialize)]
pub struct BackendDiagnostic {
    pub at: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

#[derive(Debug, Default)]
struct BackendProcessState {
    managed: bool,
    child: Option<Child>,
}

pub struct BackendManager {
    state: Mutex<BackendProcessState>,
    diagnostics: Arc<Mutex<Vec<BackendDiagnostic>>>,
}

impl BackendManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(BackendProcessState::default()),
            diagnostics: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn push_diagnostic(&self, level: &str, source: &str, message: impl Into<String>) {
        let mut diagnostics = self
            .diagnostics
            .lock()
            .expect("backend diagnostics mutex should not be poisoned");
        diagnostics.push(BackendDiagnostic {
            at: now_iso8601_like(),
            level: level.to_owned(),
            source: source.to_owned(),
            message: message.into(),
        });
    }

    fn clear_diagnostics(&self) {
        let mut diagnostics = self
            .diagnostics
            .lock()
            .expect("backend diagnostics mutex should not be poisoned");
        diagnostics.clear();
    }

    fn stop_locked_process(state: &mut BackendProcessState) {
        if let Some(mut child) = state.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        state.managed = false;
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStartRequest {
    pub mode: String,
    pub host: String,
    pub port: u16,
    pub backend_root: Option<String>,
    pub python_executable: Option<String>,
    pub config_path: String,
    pub output_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStartResponse {
    pub mode: String,
    pub host: String,
    pub port: u16,
    pub managed: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStopResponse {
    pub managed_process_stopped: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOutputFolderRequest {
    pub path: String,
}

#[tauri::command]
pub fn backend_start(
    request: BackendStartRequest,
    manager: tauri::State<BackendManager>,
) -> Result<BackendStartResponse, String> {
    manager.clear_diagnostics();
    manager.push_diagnostic(
        "info",
        "lifecycle",
        format!("Backend start requested in {} mode.", request.mode),
    );

    let mut state = manager
        .state
        .lock()
        .map_err(|_| "backend lifecycle state mutex poisoned".to_owned())?;
    BackendManager::stop_locked_process(&mut state);

    if request.mode == "attach" {
        state.managed = false;
        manager.push_diagnostic(
            "info",
            "lifecycle",
            format!(
                "Attach mode selected. External backend expected at {}:{}.",
                request.host, request.port
            ),
        );
        return Ok(BackendStartResponse {
            mode: request.mode,
            host: request.host,
            port: request.port,
            managed: false,
            message: "Attach mode active".to_owned(),
        });
    }

    if request.mode != "dev-python" {
        return Err(format!("Unsupported backend mode: {}", request.mode));
    }

    if !Path::new(&request.output_path).is_absolute() {
        return Err("outputPath must be absolute for managed backend startup".to_owned());
    }

    let backend_root = request
        .backend_root
        .clone()
        .ok_or_else(|| "backendRoot is required for dev-python mode".to_owned())?;
    if !Path::new(&backend_root).exists() {
        return Err(format!("backendRoot does not exist: {}", backend_root));
    }

    let python_executable = request.python_executable.unwrap_or_else(|| "python".to_owned());
    let mut command = Command::new(&python_executable);
    command
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .arg("run.py")
        .arg("--serve")
        .arg("--serve-host")
        .arg(&request.host)
        .arg("--serve-port")
        .arg(request.port.to_string())
        .arg("--config")
        .arg(&request.config_path)
        .arg("--path")
        .arg(&request.output_path)
        .current_dir(&backend_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    manager.push_diagnostic(
        "info",
        "lifecycle",
        format!(
            "Spawning managed backend command: {} run.py --serve --serve-host {} --serve-port {} --config <managed> --path <absolute-output> (PYTHONUTF8=1, PYTHONIOENCODING=utf-8)",
            python_executable, request.host, request.port
        ),
    );

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start managed backend process: {}", error))?;

    if let Some(stdout) = child.stdout.take() {
        let diagnostics_ref = Arc::clone(&manager.diagnostics);
        thread::spawn(move || read_stream_lines(stdout, diagnostics_ref, "stdout"));
    }

    if let Some(stderr) = child.stderr.take() {
        let diagnostics_ref = Arc::clone(&manager.diagnostics);
        thread::spawn(move || read_stream_lines(stderr, diagnostics_ref, "stderr"));
    }

    state.managed = true;
    state.child = Some(child);

    Ok(BackendStartResponse {
        mode: request.mode,
        host: request.host,
        port: request.port,
        managed: true,
        message: "Managed backend process started".to_owned(),
    })
}

#[tauri::command]
pub fn backend_stop(manager: tauri::State<BackendManager>) -> Result<BackendStopResponse, String> {
    let mut state = manager
        .state
        .lock()
        .map_err(|_| "backend lifecycle state mutex poisoned".to_owned())?;

    if state.managed {
        BackendManager::stop_locked_process(&mut state);
        manager.push_diagnostic("info", "lifecycle", "Managed backend process stopped.");
        return Ok(BackendStopResponse {
            managed_process_stopped: true,
            message: "Managed backend process stopped".to_owned(),
        });
    }

    manager.push_diagnostic(
        "info",
        "lifecycle",
        "Stop requested with no managed process. External backend unchanged.",
    );
    Ok(BackendStopResponse {
        managed_process_stopped: false,
        message: "No managed process to stop".to_owned(),
    })
}

#[tauri::command]
pub fn backend_diagnostics(manager: tauri::State<BackendManager>) -> Result<Vec<BackendDiagnostic>, String> {
    let diagnostics = manager
        .diagnostics
        .lock()
        .map_err(|_| "backend diagnostics mutex poisoned".to_owned())?;
    Ok(diagnostics.clone())
}

#[tauri::command]
pub fn open_output_folder(
    request: OpenOutputFolderRequest,
    manager: tauri::State<BackendManager>,
) -> Result<(), String> {
    let path = request.path.trim().to_owned();
    if path.is_empty() {
        return Err("Output folder path is empty".to_owned());
    }

    let folder = Path::new(&path);
    if !folder.is_absolute() {
        return Err(format!("Output folder path must be absolute: {}", path));
    }
    if !folder.exists() {
        return Err(format!("Output folder path does not exist: {}", path));
    }
    if !folder.is_dir() {
        return Err(format!("Output folder path is not a directory: {}", path));
    }

    let mut command = Command::new("explorer");
    command.arg(&path).stdout(Stdio::null()).stderr(Stdio::null());
    command
        .spawn()
        .map_err(|error| format!("Failed to open output folder '{}': {}", path, error))?;
    manager.push_diagnostic("info", "filesystem", format!("Opened output folder: {}", path));
    Ok(())
}

fn read_stream_lines<R: std::io::Read>(
    stream: R,
    diagnostics_ref: Arc<Mutex<Vec<BackendDiagnostic>>>,
    source: &str,
) {
    let reader = BufReader::new(stream);
    for line_result in reader.lines() {
        if let Ok(line) = line_result {
            let mut diagnostics = diagnostics_ref
                .lock()
                .expect("backend diagnostics mutex should not be poisoned");
            diagnostics.push(BackendDiagnostic {
                at: now_iso8601_like(),
                level: "info".to_owned(),
                source: source.to_owned(),
                message: line,
            });
        }
    }
}

fn now_iso8601_like() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}Z", now.as_secs(), now.subsec_millis())
}
