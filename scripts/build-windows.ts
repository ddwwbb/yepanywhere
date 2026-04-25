#!/usr/bin/env tsx

import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const BUNDLE_DIR = path.join(ROOT_DIR, "dist", "npm-package");
const WINDOWS_ROOT = path.join(ROOT_DIR, "dist", "windows");
const APP_NAME = "YepAnywhere";
const OUTPUT_DIR = path.join(WINDOWS_ROOT, APP_NAME);
const APP_DIR = path.join(OUTPUT_DIR, "app");
const NODE_DIR = path.join(OUTPUT_DIR, "node");
const LAUNCHER_SOURCE = path.join(OUTPUT_DIR, "YepAnywhere.Launcher.cs");
const LAUNCHER_EXE = path.join(OUTPUT_DIR, `${APP_NAME}.exe`);
const LAUNCHER_CMD = path.join(OUTPUT_DIR, `${APP_NAME}.cmd`);

interface StepResult {
  step: string;
  success: boolean;
  error?: string;
}

const results: StepResult[] = [];

function log(message: string): void {
  console.log(`[build-windows] ${message}`);
}

function step(name: string, fn: () => void): void {
  log(`\n${"=".repeat(60)}`);
  log(`Step: ${name}`);
  log("=".repeat(60));

  try {
    fn();
    results.push({ step: name, success: true });
    log(`✓ ${name} completed`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    results.push({ step: name, success: false, error });
    log(`✗ ${name} failed: ${error}`);
    throw err;
  }
}

function exec(command: string, cwd = ROOT_DIR): void {
  execSync(command, { cwd, stdio: "inherit" });
}

function copyRecursive(src: string, dest: string): void {
  const stats = fs.statSync(src);

  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }

  fs.copyFileSync(src, dest);
}

function findCsc(): string | null {
  const candidates = [
    process.env.CSC,
    "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe",
    "C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  try {
    return execSync("where.exe csc.exe", { encoding: "utf-8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function createCmdLauncher(): void {
  const content = `@echo off
setlocal
title Yep Anywhere
set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%app"
set "NODE_EXE=%ROOT_DIR%node\\node.exe"

if not exist "%NODE_EXE%" (
  set "NODE_EXE=node"
)

if not exist "%APP_DIR%\\dist\\cli.js" (
  echo [Yep Anywhere] Missing app\\dist\\cli.js
  echo [Yep Anywhere] Please rebuild the Windows package.
  pause
  exit /b 1
)

cd /d "%APP_DIR%"
"%NODE_EXE%" "%APP_DIR%\\dist\\cli.js" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo [Yep Anywhere] exited with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
`;

  fs.writeFileSync(LAUNCHER_CMD, content, "utf-8");
}

function createCSharpLauncherSource(): void {
  const source = String.raw`using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class YepAnywhereLauncher
{
    static int Main(string[] args)
    {
        Console.Title = "Yep Anywhere";
        string rootDir = AppDomain.CurrentDomain.BaseDirectory;
        string appDir = Path.Combine(rootDir, "app");
        string nodeExe = Path.Combine(rootDir, "node", "node.exe");
        string cliPath = Path.Combine(appDir, "dist", "cli.js");

        if (!File.Exists(nodeExe))
        {
            nodeExe = "node";
        }

        if (!File.Exists(cliPath))
        {
            Console.Error.WriteLine("[Yep Anywhere] Missing app\\dist\\cli.js");
            Console.Error.WriteLine("[Yep Anywhere] Please rebuild the Windows package.");
            Console.WriteLine();
            Console.WriteLine("Press any key to close...");
            Console.ReadKey(true);
            return 1;
        }

        var arguments = new StringBuilder();
        arguments.Append(Quote(cliPath));
        foreach (string arg in args)
        {
            arguments.Append(' ');
            arguments.Append(Quote(arg));
        }

        var psi = new ProcessStartInfo
        {
            FileName = nodeExe,
            Arguments = arguments.ToString(),
            WorkingDirectory = appDir,
            UseShellExecute = false
        };

        psi.EnvironmentVariables["NODE_ENV"] = "production";

        try
        {
            using (var process = Process.Start(psi))
            {
                if (process == null)
                {
                    Console.Error.WriteLine("[Yep Anywhere] Failed to start Node.js process.");
                    return 1;
                }

                process.WaitForExit();
                Console.WriteLine();
                Console.WriteLine("[Yep Anywhere] exited with code " + process.ExitCode + ".");
                Console.WriteLine("Press any key to close...");
                Console.ReadKey(true);
                return process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("[Yep Anywhere] Failed to start: " + ex.Message);
            Console.WriteLine();
            Console.WriteLine("Press any key to close...");
            Console.ReadKey(true);
            return 1;
        }
    }

    static string Quote(string value)
    {
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}
`;

  fs.writeFileSync(LAUNCHER_SOURCE, source, "utf-8");
}

function compileLauncher(): void {
  const csc = findCsc();
  if (!csc) {
    log("C# compiler not found. YepAnywhere.cmd was generated as a fallback launcher.");
    return;
  }

  execFileSync(
    csc,
    [
      "/nologo",
      "/target:exe",
      "/platform:anycpu",
      `/out:${LAUNCHER_EXE}`,
      LAUNCHER_SOURCE,
    ],
    { stdio: "inherit" },
  );
}

step("Build npm bundle", () => {
  exec("pnpm build:bundle");
});

step("Clean Windows output", () => {
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(APP_DIR, { recursive: true });
  fs.mkdirSync(NODE_DIR, { recursive: true });
});

step("Copy bundled app", () => {
  if (!fs.existsSync(BUNDLE_DIR)) {
    throw new Error(`Bundle directory not found: ${BUNDLE_DIR}`);
  }
  copyRecursive(BUNDLE_DIR, APP_DIR);
});

step("Install production dependencies", () => {
  exec("npm install --omit=dev --no-audit --no-fund", APP_DIR);
});

step("Bundle Node.js runtime", () => {
  const nodeExe = process.execPath;
  const destNodeExe = path.join(NODE_DIR, "node.exe");
  fs.copyFileSync(nodeExe, destNodeExe);

  const nodeRoot = path.dirname(nodeExe);
  const extraFiles = ["icudtl.dat", "snapshot_blob.bin", "v8_context_snapshot.bin"];
  for (const file of extraFiles) {
    const src = path.join(nodeRoot, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(NODE_DIR, file));
    }
  }
});

step("Create launchers", () => {
  createCmdLauncher();
  createCSharpLauncherSource();
  compileLauncher();
});

step("Write usage notes", () => {
  const readme = `# Yep Anywhere Windows Package

双击 \`YepAnywhere.exe\` 启动服务。

如果当前环境没有可用的 C# 编译器，打包脚本会至少生成 \`YepAnywhere.cmd\`，双击它也可以启动服务。

## 行为

- 启动后会打开控制台窗口。
- 服务默认监听 \`http://localhost:3400\`。
- 关闭控制台窗口后服务会结束。
- 需要使用的 Agent CLI（Claude Code、Codex、Gemini、OpenCode 等）仍需在系统中单独安装并可被 PATH 找到。

## 自定义端口

可以从命令行传参：

\`\`\`bat
YepAnywhere.exe --port 4000
\`\`\`

也可以使用环境变量：

\`\`\`bat
set PORT=4000
YepAnywhere.exe
\`\`\`
`;

  fs.writeFileSync(path.join(OUTPUT_DIR, "README.md"), readme, "utf-8");
});

log(`\n${"=".repeat(60)}`);
log("Build Summary");
log("=".repeat(60));
for (const result of results) {
  log(`${result.success ? "✓" : "✗"} ${result.step}`);
  if (result.error) log(`  Error: ${result.error}`);
}

log("\nWindows package created:");
log(`  ${path.relative(ROOT_DIR, OUTPUT_DIR)}`);
log("\nLaunchers:");
log(`  ${path.relative(ROOT_DIR, LAUNCHER_EXE)}${fs.existsSync(LAUNCHER_EXE) ? "" : " (not generated)"}`);
log(`  ${path.relative(ROOT_DIR, LAUNCHER_CMD)}`);

if (os.platform() !== "win32") {
  log("\nNote: This package is intended for Windows. Build it on Windows to generate/test the .exe launcher.");
}
