use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsEnsureDirectoryRequest {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsWriteConfigAtomicRequest {
    pub path: String,
    pub contents: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieCaptureAndCommitRequest {
    pub backend_root: String,
    pub managed_config_path: String,
    pub output_path: String,
    pub python_executable: Option<String>,
    pub browser: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieCaptureAndCommitResponse {
    pub status: String,
    pub exit_code: Option<i32>,
    pub diagnostics: Vec<String>,
    pub cookies: Option<BTreeMap<String, String>>,
    pub error: Option<String>,
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
pub fn cookie_capture_and_commit(
    request: CookieCaptureAndCommitRequest,
) -> Result<CookieCaptureAndCommitResponse, String> {
    const REQUIRED_COOKIE_KEYS: [&str; 4] = ["msToken", "ttwid", "odin_tt", "passport_csrf_token"];

    let backend_root = PathBuf::from(request.backend_root.trim());
    if !backend_root.is_absolute() {
        return Ok(CookieCaptureAndCommitResponse {
            status: "failed".to_owned(),
            exit_code: None,
            diagnostics: Vec::new(),
            cookies: None,
            error: Some("Backend root must be an absolute path.".to_owned()),
        });
    }
    if !backend_root.exists() {
        return Ok(CookieCaptureAndCommitResponse {
            status: "failed".to_owned(),
            exit_code: None,
            diagnostics: Vec::new(),
            cookies: None,
            error: Some(format!(
                "Backend root does not exist: {}",
                backend_root.display()
            )),
        });
    }

    let output_path = PathBuf::from(request.output_path.trim());
    if !output_path.is_absolute() {
        return Ok(CookieCaptureAndCommitResponse {
            status: "failed".to_owned(),
            exit_code: None,
            diagnostics: Vec::new(),
            cookies: None,
            error: Some("Cookie output path must be absolute.".to_owned()),
        });
    }

    let managed_config_path = PathBuf::from(request.managed_config_path.trim());
    if !managed_config_path.is_absolute() {
        return Ok(CookieCaptureAndCommitResponse {
            status: "failed".to_owned(),
            exit_code: None,
            diagnostics: Vec::new(),
            cookies: None,
            error: Some("Managed config path must be absolute.".to_owned()),
        });
    }

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to ensure cookie output directory '{}': {}",
                parent.display(),
                error
            )
        })?;
    }

    let python_executable = request.python_executable.unwrap_or_else(|| "python".to_owned());
    let browser = request.browser.unwrap_or_else(|| "chromium".to_owned());
    let mut command = Command::new(&python_executable);
    command
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .arg("-m")
        .arg("tools.cookie_fetcher")
        .arg("--output")
        .arg(output_path.as_os_str())
        .arg("--browser")
        .arg(&browser)
        .current_dir(&backend_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(spawned) => spawned,
        Err(error) => {
            return Ok(CookieCaptureAndCommitResponse {
                status: "failed".to_owned(),
                exit_code: None,
                diagnostics: Vec::new(),
                cookies: None,
                error: Some(format!("Failed to start cookie fetcher process: {}", error)),
            });
        }
    };

    if let Some(mut stdin) = child.stdin.take() {
        if let Err(error) = writeln!(stdin) {
            return Ok(CookieCaptureAndCommitResponse {
                status: "failed".to_owned(),
                exit_code: None,
                diagnostics: Vec::new(),
                cookies: None,
                error: Some(format!("Failed to confirm cookie capture from app boundary: {}", error)),
            });
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed while waiting for cookie fetcher process: {}", error))?;

    let mut diagnostics = Vec::new();
    diagnostics.extend(
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|line| format!("stdout: {}", line)),
    );
    diagnostics.extend(
        String::from_utf8_lossy(&output.stderr)
            .lines()
            .map(|line| format!("stderr: {}", line)),
    );

    let exit_code = output.status.code();
    if !output.status.success() {
        return Ok(CookieCaptureAndCommitResponse {
            status: "failed".to_owned(),
            exit_code,
            diagnostics,
            cookies: None,
            error: Some("Cookie fetcher exited with a non-zero status.".to_owned()),
        });
    }

    let raw = match fs::read_to_string(&output_path) {
        Ok(contents) => contents,
        Err(error) => {
            return Ok(CookieCaptureAndCommitResponse {
                status: "failed".to_owned(),
                exit_code,
                diagnostics,
                cookies: None,
                error: Some(format!(
                    "Cookie output file was not created or readable '{}': {}",
                    output_path.display(),
                    error
                )),
            });
        }
    };

    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => {
            return Ok(CookieCaptureAndCommitResponse {
                status: "failed".to_owned(),
                exit_code,
                diagnostics,
                cookies: None,
                error: Some(format!("Cookie output JSON is invalid: {}", error)),
            });
        }
    };

    let cookies_object = match parsed.as_object() {
        Some(value) => value,
        None => {
            return Ok(CookieCaptureAndCommitResponse {
                status: "failed".to_owned(),
                exit_code,
                diagnostics,
                cookies: None,
                error: Some("Cookie output JSON must be an object.".to_owned()),
            });
        }
    };

    let mut cookies = BTreeMap::new();
    for (key, value) in cookies_object {
        if let Some(string_value) = value.as_str() {
            let clean_key = key.trim().to_owned();
            let clean_value = string_value.trim().to_owned();
            if !clean_key.is_empty() && !clean_value.is_empty() {
                cookies.insert(clean_key, clean_value);
            }
        }
    }

    let missing: Vec<&str> = REQUIRED_COOKIE_KEYS
        .iter()
        .copied()
        .filter(|key| !cookies.contains_key(*key))
        .collect();
    if !missing.is_empty() {
        diagnostics.push(format!("Missing required cookie keys: {}", missing.join(", ")));
        return Ok(CookieCaptureAndCommitResponse {
            status: "failed".to_owned(),
            exit_code,
            diagnostics,
            cookies: Some(cookies),
            error: Some("Cookie capture completed with missing required keys.".to_owned()),
        });
    }

    let existing_yaml = if managed_config_path.exists() {
        fs::read_to_string(&managed_config_path).map_err(|error| {
            format!(
                "Failed to read managed config '{}': {}",
                managed_config_path.display(),
                error
            )
        })?
    } else {
        String::new()
    };

    let mut config_value: serde_yaml::Value = if existing_yaml.trim().is_empty() {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    } else {
        serde_yaml::from_str(&existing_yaml).map_err(|error| {
            format!(
                "Managed config is invalid YAML '{}': {}",
                managed_config_path.display(),
                error
            )
        })?
    };

    if !config_value.is_mapping() {
        config_value = serde_yaml::Value::Mapping(serde_yaml::Mapping::new());
    }

    let mapping = config_value
        .as_mapping_mut()
        .expect("value should be mapping after normalization");
    let mut cookie_mapping = serde_yaml::Mapping::new();
    for (key, value) in &cookies {
        cookie_mapping.insert(
            serde_yaml::Value::String(key.to_owned()),
            serde_yaml::Value::String(value.to_owned()),
        );
    }
    mapping.insert(
        serde_yaml::Value::String("cookies".to_owned()),
        serde_yaml::Value::Mapping(cookie_mapping),
    );

    let yaml_text = serde_yaml::to_string(&config_value)
        .map_err(|error| format!("Failed to serialize managed config cookies: {}", error))?;
    write_file_atomic(&managed_config_path, &yaml_text, "managed-config").map_err(|error| {
        format!(
            "Failed to commit managed cookie config '{}': {}",
            managed_config_path.display(),
            error
        )
    })?;

    Ok(CookieCaptureAndCommitResponse {
        status: "success".to_owned(),
        exit_code,
        diagnostics,
        cookies: Some(cookies),
        error: None,
    })
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

#[tauri::command]
pub fn settings_ensure_directory(request: SettingsEnsureDirectoryRequest) -> Result<(), String> {
    let path = request.path.trim().to_owned();
    if path.is_empty() {
        return Err("Directory path is empty".to_owned());
    }
    let directory = Path::new(&path);
    if !directory.is_absolute() {
        return Err(format!("Directory path must be absolute: {}", path));
    }
    fs::create_dir_all(directory)
        .map_err(|error| format!("Failed to ensure directory '{}': {}", path, error))?;
    Ok(())
}

#[tauri::command]
pub fn settings_write_config_atomic(request: SettingsWriteConfigAtomicRequest) -> Result<(), String> {
    let path = request.path.trim().to_owned();
    if path.is_empty() {
        return Err("Managed config path is empty".to_owned());
    }

    let target_path = PathBuf::from(&path);
    if !target_path.is_absolute() {
        return Err(format!("Managed config path must be absolute: {}", path));
    }

    write_file_atomic(&target_path, &request.contents, "managed-config")
}

fn write_file_atomic(target_path: &Path, contents: &str, temp_label: &str) -> Result<(), String> {
    let parent = target_path.parent().ok_or_else(|| {
        format!(
            "Target file must have a parent directory: {}",
            target_path.display()
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed to ensure parent directory '{}': {}",
            parent.display(),
            error
        )
    })?;

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_path = parent.join(format!(".{}-{}-{}.tmp", temp_label, std::process::id(), nonce));

    fs::write(&temp_path, contents.as_bytes()).map_err(|error| {
        format!(
            "Failed to write temp file '{}': {}",
            temp_path.display(),
            error
        )
    })?;

    if target_path.exists() {
        fs::remove_file(target_path).map_err(|error| {
            format!(
                "Failed to replace existing file '{}': {}",
                target_path.display(),
                error
            )
        })?;
    }

    fs::rename(&temp_path, target_path).map_err(|error| {
        format!(
            "Failed to commit file '{}': {}",
            target_path.display(),
            error
        )
    })?;
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
