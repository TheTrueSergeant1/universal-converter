#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Emitter};
use std::path::Path;
use std::fs;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

fn parse_time(time_str: &str) -> Option<f64> {
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() == 3 {
        let hours: f64 = parts[0].parse().unwrap_or(0.0);
        let minutes: f64 = parts[1].parse().unwrap_or(0.0);
        let seconds: f64 = parts[2].parse().unwrap_or(0.0);
        Some(hours * 3600.0 + minutes * 60.0 + seconds)
    } else {
        None
    }
}

// Helper to send raw logs to the React developer console
fn emit_log(app: &AppHandle, msg: &str) {
    let _ = app.emit("engine-log", msg.to_string());
}

#[tauri::command]
async fn process_file(
    app: AppHandle, 
    file_id: String, 
    file_name: String, 
    file_path: String, 
    target_format: String, 
    quality: String
) -> Result<String, String> {
    
    emit_log(&app, &format!(">> INITIALIZING JOB: {}", file_name));
    emit_log(&app, ">> STAGE 1: EXECUTING SECURITY PROTOCOLS...");

    // A. Path Traversal & Symlink Mitigation
    let canonical_path = fs::canonicalize(&file_path).map_err(|_| {
        emit_log(&app, "[ERROR] Path traversal detected or file missing.");
        "Security Error: Path traversal detected."
    })?;

    if !canonical_path.is_file() {
        emit_log(&app, "[ERROR] Target is not a valid file.");
        return Err("Security Error: Target is not a valid file.".to_string());
    }

    // B. Magic Bytes / MIME-Type Validation
    emit_log(&app, "   -> Reading binary magic bytes...");
    let kind = infer::get_from_path(&canonical_path).map_err(|_| "Security Error: Could not read file signature.")?;
    let input_ext = canonical_path.extension().unwrap_or_default().to_string_lossy().to_lowercase();

    if let Some(k) = kind {
        let mime = k.mime_type();
        emit_log(&app, &format!("   -> Detected signature: {}", mime));
        
        let is_safe = mime.starts_with("video/") || mime.starts_with("audio/") || 
                      mime.starts_with("image/") || mime.contains("pdf") ||
                      mime.contains("document") || mime.contains("zip"); 

        if !is_safe {
            emit_log(&app, "[FATAL] Malicious file signature blocked.");
            return Err(format!("Security Error: Malicious file signature detected ({})", mime));
        }
    } else {
        if input_ext != "txt" && input_ext != "md" {
            emit_log(&app, "[FATAL] Unknown binary disguised as valid format.");
            return Err("Security Error: Unknown binary signature disguised as a valid format.".to_string());
        }
        emit_log(&app, "   -> Text file verified safely.");
    }

    emit_log(&app, ">> SECURITY CLEARANCE GRANTED. ROUTING TO ENGINE...");
    
    // Tell the UI to transition from "verifying" to "converting"
    let _ = app.emit("conversion-progress", format!("{}|0", file_id));

    let path = Path::new(&file_path);
    let output_path = path.with_extension(&target_format);

    let video_audio = ["mp4", "mov", "mkv", "avi", "mp3", "wav", "aac", "m4a"];
    let image = ["jpg", "jpeg", "png", "gif", "heic", "webp", "raw", "tiff"];
    let document = ["docx", "md", "txt", "epub", "rtf"];

    if document.contains(&input_ext.as_str()) {
        emit_log(&app, ">> ENGINE: PANDOC");
        let output = app.shell().sidecar("pandoc").map_err(|e| format!("Failed to find sidecar: {}", e))?
            .args([&file_path, "-o", output_path.to_str().unwrap()]).output().await.map_err(|e| e.to_string())?;
            
        let _ = app.emit("conversion-progress", format!("{}|100", file_id));
        emit_log(&app, ">> JOB SUCCESS");
        return if output.status.success() { Ok(format!("Saved as .{}", target_format.to_uppercase())) } 
               else { Err(String::from_utf8_lossy(&output.stderr).to_string()) };
    } 
    
    if image.contains(&input_ext.as_str()) {
        emit_log(&app, ">> ENGINE: IMAGEMAGICK");
        let output = app.shell().sidecar("magick").map_err(|e| format!("Failed to find sidecar: {}", e))?
            .args([&file_path, output_path.to_str().unwrap()]).output().await.map_err(|e| e.to_string())?;

        let _ = app.emit("conversion-progress", format!("{}|100", file_id));
        emit_log(&app, ">> JOB SUCCESS");
        return if output.status.success() { Ok(format!("Saved as .{}", target_format.to_uppercase())) } 
               else { Err(String::from_utf8_lossy(&output.stderr).to_string()) };
    }

    if video_audio.contains(&input_ext.as_str()) {
        emit_log(&app, ">> ENGINE: FFMPEG");
        let mut command_args = vec!["-y", "-i", &file_path];

        if target_format == "mp4" || target_format == "mov" {
            match quality.as_str() {
                "high" => { command_args.push("-crf"); command_args.push("18"); },
                "low" => { command_args.push("-crf"); command_args.push("28"); },
                _ => { command_args.push("-crf"); command_args.push("23"); } 
            }
        } else if target_format == "mp3" {
            match quality.as_str() {
                "high" => { command_args.push("-b:a"); command_args.push("320k"); },
                "low" => { command_args.push("-b:a"); command_args.push("128k"); },
                _ => { command_args.push("-b:a"); command_args.push("192k"); } 
            }
        }

        command_args.push(output_path.to_str().unwrap());

        let (mut rx, mut _child) = app.shell().sidecar("ffmpeg").map_err(|e| format!("Failed to find sidecar: {}", e))?
            .args(&command_args).spawn().map_err(|e| format!("FFmpeg failed to start: {}", e))?;

        let mut total_duration: f64 = 0.0;

        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stderr(line_bytes) = event {
                let line = String::from_utf8_lossy(&line_bytes);
                emit_log(&app, line.trim()); // Stream FFmpeg logs directly to UI
                
                if line.contains("Duration: ") {
                    if let Some(dur_str) = line.split("Duration: ").nth(1).and_then(|s| s.split(',').next()) {
                        if let Some(dur) = parse_time(dur_str.trim()) { total_duration = dur; }
                    }
                }
                
                if line.contains("time=") {
                    if let Some(time_str) = line.split("time=").nth(1).and_then(|s| s.split(' ').next()) {
                        if let Some(current_time) = parse_time(time_str.trim()) {
                            if total_duration > 0.0 {
                                let percentage = (current_time / total_duration) * 100.0;
                                let _ = app.emit("conversion-progress", format!("{}|{}", file_id, percentage));
                            }
                        }
                    }
                }
            }
        }
        
        emit_log(&app, ">> JOB SUCCESS");
        return Ok(format!("Saved as .{}", target_format.to_uppercase()));
    }

    Err("Unsupported file format.".to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![process_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}