use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const BACKEND_DIAGNOSTICS_CAP: usize = 500;
const REQUIRED_COOKIE_KEYS: [&str; 4] = ["msToken", "ttwid", "odin_tt", "passport_csrf_token"];
const COOKIE_CAPTURE_TIMEOUT: Duration = Duration::from_secs(120);
const COOKIE_CAPTURE_CONFIRMATION_DELAY: Duration = Duration::from_secs(45);
const SIDECAR_BINARY_NAMES: [&str; 3] = [
    "douyin-backend-sidecar-entry.exe",
    "douyin-backend-sidecar.exe",
    "douyin-backend.exe",
];

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
        push_bounded_diagnostic(&mut diagnostics, BackendDiagnostic {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendRuntimePathsResponse {
    pub managed_config_path: String,
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

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum CookieProcessFailureKind {
    Timeout,
    NonZeroExit,
}

enum CookieProcessWait {
    Completed(Output),
    TimedOut(Vec<String>),
}

#[tauri::command]
pub fn backend_start(
    request: BackendStartRequest,
    manager: tauri::State<BackendManager>,
    app_handle: tauri::AppHandle,
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

    if !Path::new(&request.output_path).is_absolute() {
        return Err("outputPath must be absolute for managed backend startup".to_owned());
    }
    let mode = request.mode.clone();
    let mut command;
    let lifecycle_message;
    if mode == "dev-python" {
        let backend_root = request
            .backend_root
            .clone()
            .ok_or_else(|| "backendRoot is required for dev-python mode".to_owned())?;
        if !Path::new(&backend_root).exists() {
            return Err(format!("backendRoot does not exist: {}", backend_root));
        }

        let python_executable = request.python_executable.unwrap_or_else(|| "python".to_owned());
        command = Command::new(&python_executable);
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
        lifecycle_message = format!(
            "Spawning dev-python backend command: {} run.py --serve --serve-host {} --serve-port {} --config <managed> --path <absolute-output> (PYTHONUTF8=1, PYTHONIOENCODING=utf-8)",
            python_executable, request.host, request.port
        );
    } else if mode == "managed-sidecar" {
        let sidecar_path = resolve_sidecar_executable(&app_handle)?;
        command = Command::new(&sidecar_path);
        command
            .arg("--serve-host")
            .arg(&request.host)
            .arg("--serve-port")
            .arg(request.port.to_string())
            .arg("--config")
            .arg(&request.config_path)
            .arg("--path")
            .arg(&request.output_path)
            .current_dir(
                sidecar_path
                    .parent()
                    .ok_or_else(|| "sidecar executable has no parent directory".to_owned())?,
            )
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        lifecycle_message = format!(
            "Spawning managed sidecar backend command: {} --serve-host {} --serve-port {} --config <managed> --path <absolute-output>",
            sidecar_path.display(),
            request.host,
            request.port
        );
    } else {
        return Err(format!("Unsupported backend mode: {}", request.mode));
    }

    manager.push_diagnostic("info", "lifecycle", lifecycle_message);

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
pub fn backend_runtime_paths(
    app_handle: tauri::AppHandle,
) -> Result<BackendRuntimePathsResponse, String> {
    let managed_config_path = resolve_managed_config_path(&app_handle)?;
    Ok(BackendRuntimePathsResponse {
        managed_config_path: managed_config_path.display().to_string(),
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

fn resolve_managed_config_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(app_data) = app_handle.path().app_local_data_dir() {
        return Ok(app_data.join("runtime").join("managed-config.yml"));
    }
    let executable = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve current executable path: {error}"))?;
    let executable_directory = executable
        .parent()
        .ok_or_else(|| "Current executable path has no parent directory".to_owned())?;
    Ok(executable_directory
        .join(".runtime")
        .join("managed-config.yml"))
}

fn resolve_sidecar_executable(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        roots.push(resource_dir);
    }

    if let Some(path) = resolve_sidecar_executable_from_roots(&roots) {
        return Ok(path);
    }

    let searched = roots
        .iter()
        .map(|root| root.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Managed sidecar executable was not found. searchedRoots=[{}], candidates=[{}]",
        searched,
        SIDECAR_BINARY_NAMES.join(", ")
    ))
}

fn resolve_sidecar_executable_from_roots(search_roots: &[PathBuf]) -> Option<PathBuf> {
    for root in search_roots {
        for name in SIDECAR_BINARY_NAMES {
            let nested = root.join("backend").join(name);
            if nested.is_file() {
                return Some(nested);
            }
            let direct = root.join(name);
            if direct.is_file() {
                return Some(direct);
            }
        }
    }
    None
}

#[tauri::command]
pub fn cookie_capture_and_commit(
    request: CookieCaptureAndCommitRequest,
) -> Result<CookieCaptureAndCommitResponse, String> {
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

    let output_path = resolve_cookie_capture_output_path(&managed_config_path)?;

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

    let auto_confirm_scheduled =
        schedule_cookie_capture_confirmation(&mut child, COOKIE_CAPTURE_CONFIRMATION_DELAY);
    let (output, mut diagnostics) = match wait_for_cookie_process(child, COOKIE_CAPTURE_TIMEOUT)? {
        CookieProcessWait::Completed(output) => {
            let diagnostics = diagnostics_from_process_output(&output);
            (output, diagnostics)
        }
        CookieProcessWait::TimedOut(diagnostics) => {
            return Ok(build_cookie_process_failure_response(
                CookieProcessFailureKind::Timeout,
                None,
                diagnostics,
            ));
        }
    };
    if auto_confirm_scheduled {
        diagnostics.push(
            "Cookie capture is app-managed. Complete login in the opened browser window; capture continues automatically.".to_owned(),
        );
    }

    let exit_code = output.status.code();
    if !output.status.success() {
        return Ok(build_cookie_process_failure_response(
            CookieProcessFailureKind::NonZeroExit,
            exit_code,
            diagnostics,
        ));
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

    let cookies = match parse_cookie_capture_json_map(&raw) {
        Ok(cookies) => cookies,
        Err(error) => {
            return Ok(CookieCaptureAndCommitResponse {
                status: "failed".to_owned(),
                exit_code,
                diagnostics,
                cookies: None,
                error: Some(error),
            });
        }
    };

    let missing = missing_required_cookie_keys(&cookies);
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

    commit_cookies_to_managed_config(&managed_config_path, &cookies)?;

    Ok(CookieCaptureAndCommitResponse {
        status: "success".to_owned(),
        exit_code,
        diagnostics,
        cookies: Some(cookies),
        error: None,
    })
}

fn resolve_cookie_capture_output_path(managed_config_path: &Path) -> Result<PathBuf, String> {
    let runtime_directory = managed_config_path.parent().ok_or_else(|| {
        "Managed config path must include a parent directory for cookie capture.".to_owned()
    })?;
    fs::create_dir_all(runtime_directory).map_err(|error| {
        format!(
            "Failed to ensure cookie runtime directory '{}': {}",
            runtime_directory.display(),
            error
        )
    })?;
    Ok(runtime_directory.join("cookies.capture.json"))
}

fn schedule_cookie_capture_confirmation(child: &mut Child, delay: Duration) -> bool {
    let Some(mut stdin) = child.stdin.take() else {
        return false;
    };
    thread::spawn(move || {
        thread::sleep(delay);
        let _ = stdin.write_all(b"\n");
        let _ = stdin.flush();
    });
    true
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
    write_file_atomic_with_commit(target_path, contents, temp_label, |from, to| fs::rename(from, to))
}

fn write_file_atomic_with_commit<F>(
    target_path: &Path,
    contents: &str,
    temp_label: &str,
    mut commit: F,
) -> Result<(), String>
where
    F: FnMut(&Path, &Path) -> io::Result<()>,
{
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
    let pid = std::process::id();
    let temp_path = parent.join(format!(".{}-{}-{}.tmp", temp_label, std::process::id(), nonce));
    let backup_path = parent.join(format!(".{}-{}-{}.bak", temp_label, pid, nonce));

    fs::write(&temp_path, contents.as_bytes()).map_err(|error| {
        format!(
            "Failed to write temp file '{}': {}",
            temp_path.display(),
            error
        )
    })?;

    let had_existing_target = target_path.exists();
    if had_existing_target {
        fs::rename(target_path, &backup_path).map_err(|error| {
            format!(
                "Failed to replace existing file '{}': {}",
                target_path.display(),
                error
            )
        })?;
    }

    if let Err(error) = commit(&temp_path, target_path) {
        let _ = fs::remove_file(&temp_path);
        if had_existing_target && backup_path.exists() {
            if let Err(restore_error) = fs::rename(&backup_path, target_path) {
                return Err(format!(
                    "Failed to commit file '{}': {}; restore failed for '{}': {}",
                    target_path.display(),
                    error,
                    target_path.display(),
                    restore_error
                ));
            }
        }
        return Err(format!(
            "Failed to commit file '{}': {}",
            target_path.display(),
            error
        ));
    }

    if had_existing_target {
        fs::remove_file(&backup_path).map_err(|error| {
            format!(
                "Failed to clean backup file '{}' after commit: {}",
                backup_path.display(),
                error
            )
        })?;
    }
    Ok(())
}

fn commit_cookies_to_managed_config(
    managed_config_path: &Path,
    cookies: &BTreeMap<String, String>,
) -> Result<(), String> {
    let existing_yaml = if managed_config_path.exists() {
        fs::read_to_string(managed_config_path).map_err(|error| {
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
    for (key, value) in cookies {
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
    write_file_atomic(managed_config_path, &yaml_text, "managed-config").map_err(|error| {
        format!(
            "Failed to commit managed cookie config '{}': {}",
            managed_config_path.display(),
            error
        )
      })
}

fn parse_cookie_capture_json_map(raw_json: &str) -> Result<BTreeMap<String, String>, String> {
    let parsed: serde_json::Value = serde_json::from_str(raw_json)
        .map_err(|error| format!("Cookie output JSON is invalid: {}", error))?;
    let cookies_object = parsed
        .as_object()
        .ok_or_else(|| "Cookie output JSON must be an object.".to_owned())?;

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
    Ok(cookies)
}

fn wait_for_cookie_process(mut child: Child, timeout: Duration) -> Result<CookieProcessWait, String> {
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("Failed while waiting for cookie fetcher process: {}", error))?;
                return Ok(CookieProcessWait::Completed(output));
            }
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let output = child.wait_with_output().map_err(|error| {
                        format!("Failed while collecting timed-out cookie fetcher output: {}", error)
                    })?;
                    let mut diagnostics = diagnostics_from_process_output(&output);
                    diagnostics.push(format!(
                        "Cookie capture timed out after {} seconds and was cancelled.",
                        timeout.as_secs()
                    ));
                    return Ok(CookieProcessWait::TimedOut(diagnostics));
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => {
                return Err(format!(
                    "Failed while polling cookie fetcher process status: {}",
                    error
                ));
            }
        }
    }
}

fn diagnostics_from_process_output(output: &Output) -> Vec<String> {
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
    diagnostics
}

fn build_cookie_process_failure_response(
    kind: CookieProcessFailureKind,
    exit_code: Option<i32>,
    mut diagnostics: Vec<String>,
) -> CookieCaptureAndCommitResponse {
    match kind {
        CookieProcessFailureKind::Timeout => {
            if !diagnostics
                .iter()
                .any(|entry| entry.to_ascii_lowercase().contains("timed out"))
            {
                diagnostics.push("Cookie capture timed out and was cancelled.".to_owned());
            }
            CookieCaptureAndCommitResponse {
                status: "cancelled".to_owned(),
                exit_code,
                diagnostics,
                cookies: None,
                error: Some("Cookie capture timed out before completion.".to_owned()),
            }
        }
        CookieProcessFailureKind::NonZeroExit if exit_code == Some(130) => CookieCaptureAndCommitResponse {
            status: "cancelled".to_owned(),
            exit_code,
            diagnostics,
            cookies: None,
            error: Some("Cookie capture was cancelled before completion.".to_owned()),
        },
        CookieProcessFailureKind::NonZeroExit => CookieCaptureAndCommitResponse {
            status: "failed".to_owned(),
            exit_code,
            diagnostics,
            cookies: None,
            error: Some("Cookie fetcher exited with a non-zero status.".to_owned()),
        },
    }
}

fn missing_required_cookie_keys(cookies: &BTreeMap<String, String>) -> Vec<&'static str> {
    REQUIRED_COOKIE_KEYS
        .iter()
        .copied()
        .filter(|key| !cookies.contains_key(*key))
        .collect()
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
            push_bounded_diagnostic(&mut diagnostics, BackendDiagnostic {
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

fn push_bounded_diagnostic(diagnostics: &mut Vec<BackendDiagnostic>, entry: BackendDiagnostic) {
    diagnostics.push(entry);
    if diagnostics.len() > BACKEND_DIAGNOSTICS_CAP {
        let to_drop = diagnostics.len() - BACKEND_DIAGNOSTICS_CAP;
        diagnostics.drain(0..to_drop);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_cookie_process_failure_response, commit_cookies_to_managed_config,
        missing_required_cookie_keys, parse_cookie_capture_json_map, push_bounded_diagnostic,
        resolve_cookie_capture_output_path, resolve_sidecar_executable_from_roots,
        settings_write_config_atomic,
        write_file_atomic_with_commit, BackendDiagnostic, CookieProcessFailureKind,
        SettingsWriteConfigAtomicRequest, BACKEND_DIAGNOSTICS_CAP,
    };
    use std::collections::BTreeMap;
    use std::fs;
    use std::io;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn keeps_only_latest_backend_diagnostics_with_cap() {
        let mut diagnostics: Vec<BackendDiagnostic> = Vec::new();
        for index in 0..(BACKEND_DIAGNOSTICS_CAP + 5) {
            push_bounded_diagnostic(
                &mut diagnostics,
                BackendDiagnostic {
                    at: format!("t-{index}"),
                    level: "info".to_owned(),
                    source: "test".to_owned(),
                    message: format!("line-{index}"),
                },
            );
        }

        assert_eq!(diagnostics.len(), BACKEND_DIAGNOSTICS_CAP);
        assert_eq!(diagnostics.first().map(|item| item.message.as_str()), Some("line-5"));
        assert_eq!(
            diagnostics.last().map(|item| item.message.as_str()),
            Some("line-504")
        );
    }

    #[test]
    fn marks_timeout_cookie_fetch_as_cancelled() {
        let response = build_cookie_process_failure_response(
            CookieProcessFailureKind::Timeout,
            None,
            vec!["stdout: waiting".to_owned()],
        );

        assert_eq!(response.status, "cancelled");
        assert_eq!(response.exit_code, None);
        assert!(
            response
                .diagnostics
                .iter()
                .any(|entry| entry.contains("timed out"))
        );
    }

    #[test]
    fn marks_exit_code_130_cookie_fetch_as_cancelled() {
        let response = build_cookie_process_failure_response(
            CookieProcessFailureKind::NonZeroExit,
            Some(130),
            vec!["stderr: user interrupted".to_owned()],
        );

        assert_eq!(response.status, "cancelled");
        assert_eq!(response.exit_code, Some(130));
        assert_eq!(
            response.error.as_deref(),
            Some("Cookie capture was cancelled before completion.")
        );
    }

    #[test]
    fn marks_other_non_zero_cookie_fetch_as_failed() {
        let response = build_cookie_process_failure_response(
            CookieProcessFailureKind::NonZeroExit,
            Some(1),
            vec!["stderr: crash".to_owned()],
        );

        assert_eq!(response.status, "failed");
        assert_eq!(response.exit_code, Some(1));
        assert_eq!(
            response.error.as_deref(),
            Some("Cookie fetcher exited with a non-zero status.")
        );
    }

    #[test]
    fn reports_missing_required_cookie_keys() {
        let mut cookies = BTreeMap::new();
        cookies.insert("msToken".to_owned(), "a".to_owned());
        cookies.insert("ttwid".to_owned(), "b".to_owned());

        let missing = missing_required_cookie_keys(&cookies);
        assert_eq!(missing, vec!["odin_tt", "passport_csrf_token"]);
    }

    #[test]
    fn accepts_cookie_map_when_all_required_keys_exist() {
        let mut cookies = BTreeMap::new();
        cookies.insert("msToken".to_owned(), "a".to_owned());
        cookies.insert("ttwid".to_owned(), "b".to_owned());
        cookies.insert("odin_tt".to_owned(), "c".to_owned());
        cookies.insert("passport_csrf_token".to_owned(), "d".to_owned());

        let missing = missing_required_cookie_keys(&cookies);
        assert!(missing.is_empty());
    }

    #[test]
    fn resolves_cookie_capture_output_path_inside_managed_runtime_directory() {
        let root = create_test_directory("resolves_cookie_capture_output_path_inside_managed_runtime_directory");
        let runtime = root.join("runtime");
        let managed_config_path = runtime.join("managed-config.yml");
        let resolved =
            resolve_cookie_capture_output_path(&managed_config_path).expect("resolve cookie capture output path");

        assert_eq!(resolved, runtime.join("cookies.capture.json"));
        assert!(runtime.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn settings_write_config_atomic_replaces_existing_file() {
        let root = create_test_directory("settings_write_config_atomic_replaces_existing_file");
        let target = root.join("managed-config.yml");
        fs::write(&target, "old: true\n").expect("seed managed config");

        let result = settings_write_config_atomic(SettingsWriteConfigAtomicRequest {
            path: target.display().to_string(),
            contents: "new: value\n".to_owned(),
        });

        assert!(result.is_ok());
        assert_eq!(
            fs::read_to_string(&target).expect("read committed config"),
            "new: value\n"
        );
        assert_no_managed_config_temp_files(&root);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_relative_managed_config_path_for_settings_write() {
        let result = settings_write_config_atomic(SettingsWriteConfigAtomicRequest {
            path: "managed-config.yml".to_owned(),
            contents: "new: value\n".to_owned(),
        });

        assert!(result.is_err());
        assert!(
            result
                .err()
                .expect("relative-path error")
                .contains("must be absolute")
        );
    }

    #[test]
    fn cookie_commit_preserves_existing_fields_and_writes_cookies() {
        let root = create_test_directory("cookie_commit_preserves_existing_fields_and_writes_cookies");
        let target = root.join("managed-config.yml");
        fs::write(&target, "output:\n  path: C:/downloads\n").expect("seed managed config");

        let mut cookies = BTreeMap::new();
        cookies.insert("msToken".to_owned(), "token-a".to_owned());
        cookies.insert("ttwid".to_owned(), "token-b".to_owned());
        cookies.insert("odin_tt".to_owned(), "token-c".to_owned());
        cookies.insert("passport_csrf_token".to_owned(), "token-d".to_owned());

        let result = commit_cookies_to_managed_config(&target, &cookies);

        assert!(result.is_ok());
        let value: serde_yaml::Value =
            serde_yaml::from_str(&fs::read_to_string(&target).expect("read committed config"))
                .expect("parse managed config");
        let output_path = value
            .get("output")
            .and_then(|item| item.get("path"))
            .and_then(serde_yaml::Value::as_str);
        assert_eq!(output_path, Some("C:/downloads"));
        let stored_cookie = value
            .get("cookies")
            .and_then(|item| item.get("msToken"))
            .and_then(serde_yaml::Value::as_str);
        assert_eq!(stored_cookie, Some("token-a"));
        assert_no_managed_config_temp_files(&root);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_invalid_existing_yaml_when_committing_cookies() {
        let root = create_test_directory("rejects_invalid_existing_yaml_when_committing_cookies");
        let target = root.join("managed-config.yml");
        fs::write(&target, "output: [").expect("seed invalid managed config");

        let mut cookies = BTreeMap::new();
        cookies.insert("msToken".to_owned(), "token-a".to_owned());
        cookies.insert("ttwid".to_owned(), "token-b".to_owned());
        cookies.insert("odin_tt".to_owned(), "token-c".to_owned());
        cookies.insert("passport_csrf_token".to_owned(), "token-d".to_owned());

        let result = commit_cookies_to_managed_config(&target, &cookies);

        assert!(result.is_err());
        assert!(
            result
                .err()
                .expect("invalid-yaml error")
                .contains("invalid YAML")
        );
        assert_eq!(
            fs::read_to_string(&target).expect("read original invalid config"),
            "output: ["
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_malformed_cookie_capture_json() {
        let result = parse_cookie_capture_json_map("{");
        assert!(result.is_err());
        assert!(
            result
                .err()
                .expect("malformed-json error")
                .contains("invalid")
        );
    }

    #[test]
    fn rejects_non_object_cookie_capture_json() {
        let result = parse_cookie_capture_json_map("[1,2,3]");
        assert!(result.is_err());
        assert_eq!(
            result.err().as_deref(),
            Some("Cookie output JSON must be an object.")
        );
    }

    #[test]
    fn trims_and_filters_cookie_json_values() {
        let result = parse_cookie_capture_json_map(
            r#"{" msToken ":" token-a ","ttwid":" token-b ","empty":"","nonString":99}"#,
        )
        .expect("parse cookie json");

        assert_eq!(result.get("msToken").map(String::as_str), Some("token-a"));
        assert_eq!(result.get("ttwid").map(String::as_str), Some("token-b"));
        assert!(!result.contains_key("empty"));
        assert!(!result.contains_key("nonString"));
    }

    #[test]
    fn failed_atomic_commit_restores_previous_file_and_cleans_temp_files() {
        let root = create_test_directory("failed_atomic_commit_restores_previous_file_and_cleans_temp_files");
        let target = root.join("managed-config.yml");
        fs::write(&target, "original: true\n").expect("seed managed config");

        let result = write_file_atomic_with_commit(&target, "new: value\n", "managed-config", |_, _| {
            Err(io::Error::other("simulated commit failure"))
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&target).expect("read restored config"),
            "original: true\n"
        );
        assert_no_managed_config_temp_files(&root);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolves_sidecar_executable_from_backend_subdirectory() {
        let root = create_test_directory("resolves_sidecar_executable_from_backend_subdirectory");
        let backend_directory = root.join("backend");
        fs::create_dir_all(&backend_directory).expect("create backend directory");
        let sidecar = backend_directory.join("douyin-backend-sidecar-entry.exe");
        fs::write(&sidecar, "stub").expect("create sidecar stub");

        let resolved = resolve_sidecar_executable_from_roots(&[root.clone()]);

        assert_eq!(resolved.as_deref(), Some(sidecar.as_path()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolves_sidecar_executable_from_root_directory_when_backend_folder_is_missing() {
        let root = create_test_directory(
            "resolves_sidecar_executable_from_root_directory_when_backend_folder_is_missing",
        );
        let sidecar = root.join("douyin-backend-sidecar.exe");
        fs::write(&sidecar, "stub").expect("create sidecar stub");

        let resolved = resolve_sidecar_executable_from_roots(&[root.clone()]);

        assert_eq!(resolved.as_deref(), Some(sidecar.as_path()));
        let _ = fs::remove_dir_all(&root);
    }

    fn create_test_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let directory = std::env::temp_dir().join(format!(
            "douyin-downloader-app-{}-{}-{}",
            name,
            std::process::id(),
            nonce
        ));
        fs::create_dir_all(&directory).expect("create test directory");
        directory
    }

    fn assert_no_managed_config_temp_files(directory: &Path) {
        let managed_prefix = ".managed-config-";
        let entries = fs::read_dir(directory).expect("read directory");
        for entry in entries {
            let path = entry.expect("entry").path();
            if let Some(name) = path.file_name().and_then(|file_name| file_name.to_str()) {
                assert!(
                    !(name.starts_with(managed_prefix)
                        && (name.ends_with(".tmp") || name.ends_with(".bak"))),
                    "unexpected managed-config artifact left behind: {}",
                    path.display()
                );
            }
        }
    }
}
