# Universal Converter

A high-performance, cross-platform desktop application for converting video, audio, image, and document files entirely offline. 

Built with Tauri, React, and Rust, this project acts as a secure, unified graphical interface for three major open-source processing engines: **FFmpeg**, **ImageMagick**, and **Pandoc**. 

##  Features
* **Universal Format Support:** Convert between dozens of formats including `.mp4`, `.mp3`, `.wav`, `.heic`, `.raw`, `.pdf`, `.docx`, and more.
* **100% Local Processing:** No cloud servers, no file size limits, and no privacy risks. All files are processed locally on your hardware.
* **Smart Batching:** Drag and drop an entire folder of mixed file types. The backend automatically filters incompatible formats and routes each file to the correct engine.
* **Zero-Trust Security:** Built with strict input sanitization to prevent command injection and directory traversal attacks.
* **Live Developer Console:** View raw `stdout` and `stderr` logs from the underlying engines streaming directly into the frontend UI in real time.

---

##  Architecture & Deep Dive

Under the hood, Universal Converter isn't actually converting the files itself. It operates as a **Multi-Engine Router** and an **IPC (Inter-Process Communication) Bridge**. 

### 1. The Multi-Engine Router (Rust)
When you drop a file into the app, the Rust backend analyzes the file and routes it to the appropriate bundled sidecar binary:
* **FFmpeg:** Handles all media (`.mp4`, `.mov`, `.mp3`, `.wav`).
* **ImageMagick:** Handles all images, including raw camera formats and Apple's `.heic`.
* **Pandoc:** Handles document translations (e.g., Markdown to HTML, or `.docx` to `.pdf`).

Tauri's `shell` plugin is used to spawn these child processes safely without requiring the user to have any of these tools installed globally on their system.

### 2. The Security Pipeline
Wrapping command-line interfaces (CLIs) in a GUI introduces severe command injection and path traversal risks. To mitigate this, the Rust backend implements a strict zero-trust pipeline before any file touches a system shell:
* **Magic Byte Verification:** The backend completely ignores the user-provided file extension (which can easily be spoofed). Instead, it uses the `infer` crate to read the file's raw binary header (magic bytes) to verify its actual MIME type. If a `.bat` or `.sh` script is renamed to `.mp4`, the pipeline catches the signature mismatch and terminates the job.
* **Path Canonicalization:** All incoming file paths are run through `std::fs::canonicalize` to aggressively resolve symbolic links and `../` sequences, ensuring malicious inputs cannot break out of the intended directory scope to overwrite critical system files.

### 3. Frontend & State Management (React / TypeScript)
The frontend is a Vite/React application styled with Tailwind CSS and animated using Framer Motion. 
Instead of relying on standard HTML5 Drag-and-Drop (which intentionally obscures absolute file paths for security reasons), the app hooks directly into Tauri's native OS `onDragDropEvent` API. This allows the app to securely capture exact absolute paths from the host operating system to pass to the Rust backend.

---

##  Installation (End Users)

If you just want to use the app, you do not need to compile it from source.
1. Go to the [Releases](../../releases) page.
2. Download the latest installer for your operating system (e.g., the `.exe` or `.msi` for Windows).
3. Install and run. The required engines are bundled inside the app automatically.

---

## 💻 Local Development

If you want to clone this repository and build it locally, you will need to manually provide the standalone binaries for the processing engines, as they are too large to host on GitHub.

### Prerequisites
* [Node.js](https://nodejs.org/) (v18+)
* [Rust](https://www.rust-lang.org/tools/install)
* Visual Studio C++ Build Tools (Windows only)

### 1. Clone the Repository
```bash
git clone [https://github.com/YOUR_USERNAME/universal-converter.git](https://github.com/YOUR_USERNAME/universal-converter.git)
cd universal-converter
npm install
```

### 2. Add the Engine Sidecars
Tauri needs the portable executables for FFmpeg, ImageMagick, and Pandoc placed inside the `src-tauri/bin/` folder. 

1. Create a folder named `bin` inside `src-tauri`.
2. Download the portable/standalone binaries for your specific operating system:
   * [FFmpeg](https://ffmpeg.org/download.html)
   * [ImageMagick](https://imagemagick.org/script/download.php)
   * [Pandoc](https://pandoc.org/installing.html)
3. Rename the executables by appending your OS's "Target Triple". 
   * *Example for Windows x64:*
     * `ffmpeg-x86_64-pc-windows-msvc.exe`
     * `magick-x86_64-pc-windows-msvc.exe`
     * `pandoc-x86_64-pc-windows-msvc.exe`
   * *Example for Apple Silicon Mac:*
     * `ffmpeg-aarch64-apple-darwin`
     * `magick-aarch64-apple-darwin`
     * `pandoc-aarch64-apple-darwin`

### 3. Run the Development Server
Once the binaries are in place, start the Tauri dev server:

```bash
npm run tauri dev
```
### 4. Build for Production
To generate your own .exe, .msi, .dmg, or .AppImage installers:
```bash
npm run tauri build
```
## License
This project is licensed under the MIT License.
