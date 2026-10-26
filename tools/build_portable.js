'use strict';

/**
 * 生成免安装便携版并安装到目标目录：
 *   D:\Nook\Nook.exe        （可用环境变量 NOOK_OUT 覆盖安装位置）
 * 直接双击即可运行，不需要安装 Node 或依赖。
 */

const fs = require('node:fs');
const path = require('node:path');
const { NtExecutable, NtExecutableResource, Resource, Data } = require('resedit');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const OUT = process.env.NOOK_OUT ? path.resolve(process.env.NOOK_OUT) : 'D:\\Nook';
const EXE_NAME = 'Nook.exe';
const CORE_NAME = 'Nook Core.exe';
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

if (!fs.existsSync(DIST)) {
  console.error('找不到 Electron 运行时，请先执行 npm install');
  process.exit(1);
}

// 程序正在运行时文件被占用，先提示退出
if (!process.env.NOOK_SKIP_RUNNING_CHECK) {
  try {
    const { execFileSync } = require('node:child_process');
    const running = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Nook.exe', '/NH'], { encoding: 'utf8' });
    const runningCore = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Nook Core.exe', '/NH'], { encoding: 'utf8' });
    if (/Nook\.exe/i.test(running) || /Nook Core\.exe/i.test(runningCore)) {
      console.error('Nook 正在运行，请先在托盘菜单里退出程序再更新。');
      process.exit(1);
    }
  } catch {
    /* tasklist 不可用时忽略 */
  }
}

console.log('同步 Electron 运行时…');
fs.mkdirSync(OUT, { recursive: true });
// 用 robocopy /MIR 同步：既能覆盖旧文件、清掉多余文件，也不会碰到 data 目录。
// （直接用 fs.rmSync + cpSync 在本机的文件过滤驱动下会异常终止，实测退出码 0xC0000409）
{
  const { spawnSync } = require('node:child_process');
  const mirror = spawnSync(
    'robocopy',
    [DIST, OUT, '/MIR', '/XD', 'data', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1'],
    { stdio: 'inherit' }
  );
  if (mirror.status === null || mirror.status >= 8) {
    console.error('同步运行时失败，robocopy 退出码：', mirror.status);
    process.exit(1);
  }
}

const exePath = path.join(OUT, CORE_NAME);
fs.renameSync(path.join(OUT, 'electron.exe'), exePath);

const defaultApp = path.join(OUT, 'resources', 'default_app.asar');
if (fs.existsSync(defaultApp)) fs.rmSync(defaultApp);

console.log('写入应用代码…');
const appDest = path.join(OUT, 'resources', 'app');
fs.mkdirSync(appDest, { recursive: true });
fs.cpSync(path.join(ROOT, 'src'), path.join(appDest, 'src'), { recursive: true });
fs.cpSync(path.join(ROOT, 'assets'), path.join(appDest, 'assets'), { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const appPkg = {
  name: pkg.name,
  productName: pkg.productName,
  version: pkg.version,
  description: pkg.description,
  main: 'src/main.js',
  author: pkg.author,
  license: pkg.license
};
fs.writeFileSync(path.join(appDest, 'package.json'), `${JSON.stringify(appPkg, null, 2)}\n`, 'utf8');

const readme = path.join(ROOT, 'README.md');
if (fs.existsSync(readme)) fs.copyFileSync(readme, path.join(appDest, 'README.md'));

// MIT 要求随副本分发许可文本；根目录的 LICENSE 属于 Electron 本体，这里单独放一份到 app 里
const license = path.join(ROOT, 'LICENSE');
if (fs.existsSync(license)) fs.copyFileSync(license, path.join(appDest, 'LICENSE'));

console.log('改写 EXE 图标与版本信息…');
const bin = fs.readFileSync(exePath);
const exe = NtExecutable.from(bin, { ignoreCert: true });
const resources = NtExecutableResource.from(exe);

const iconFile = Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'assets', 'icon.ico')));
Resource.IconGroupEntry.replaceIconsForResource(
  resources.entries,
  1,
  1033,
  iconFile.icons.map((item) => item.data)
);

const versionInfos = Resource.VersionInfo.fromEntries(resources.entries);
if (versionInfos.length) {
  const info = versionInfos[0];
  info.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: 'Nook',
      FileDescription: 'Nook · 桌面一角的每日计划',
      CompanyName: 'Nook',
      InternalName: 'Nook',
      OriginalFilename: EXE_NAME,
      LegalCopyright: 'MIT License'
    }
  );
  info.setFileVersion(1, 0, 0, 0, 1033);
  info.setProductVersion(1, 0, 0, 0, 1033);
  info.outputToResourceEntries(resources.entries);
}

resources.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));

console.log('编译启动器…');
if (!fs.existsSync(CSC)) {
  console.error('找不到 csc.exe，无法编译启动器；将直接使用主程序作为入口');
} else {
  const { execFileSync } = require('node:child_process');
  execFileSync(
    CSC,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/r:System.Windows.Forms.dll',
      '/r:System.Drawing.dll',
      `/out:${path.join(OUT, EXE_NAME)}`,
      `/win32icon:${path.join(ROOT, 'assets', 'icon.ico')}`,
      path.join(ROOT, 'tools', 'launcher.cs')
    ],
    { stdio: 'inherit' }
  );
}

const launcherExe = path.join(OUT, EXE_NAME);

// csc 把 AssemblyTitle 写进 FileDescription，这里补成完整说明（资源管理器“说明”列更好读）
if (fs.existsSync(launcherExe)) {
  try {
    const raw = fs.readFileSync(launcherExe);
    const lExe = NtExecutable.from(raw, { ignoreCert: true });
    const lRes = NtExecutableResource.from(lExe);
    const lVers = Resource.VersionInfo.fromEntries(lRes.entries);
    if (lVers.length) {
      const lang = lVers[0].getAllLanguagesForStringValues()[0] || { lang: 1033, codepage: 1200 };
      lVers[0].setStringValue(lang, 'FileDescription', 'Nook · 桌面一角的每日计划', false);
      lVers[0].outputToResourceEntries(lRes.entries);
      lRes.outputResource(lExe);
      fs.writeFileSync(launcherExe, Buffer.from(lExe.generate()));
    }
  } catch (err) {
    console.error('设置启动器说明失败：', err.message);
  }
}

const entry = fs.existsSync(launcherExe) ? launcherExe : exePath;

console.log('写入启动脚本与说明…');
const vbs = `\uFEFF${[
  "' 双击这个文件也能启动「Nook」（推荐用桌面快捷方式）",
  'Set shell = CreateObject("WScript.Shell")',
  'shell.Environment("PROCESS")("ELECTRON_RUN_AS_NODE") = ""',
  `shell.CurrentDirectory = "${OUT}"`,
  `shell.Run """${entry}""", 1, False`
].join('\r\n')}\r\n`;
fs.writeFileSync(path.join(OUT, '启动 Nook.vbs'), vbs, 'utf16le');

const readmeRoot = path.join(ROOT, 'README.md');
if (fs.existsSync(readmeRoot)) fs.copyFileSync(readmeRoot, path.join(OUT, '使用说明.md'));

const totalBytes = (function sizeOf(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? sizeOf(full) : fs.statSync(full).size;
  }
  return total;
})(OUT);

console.log(`完成：${entry}`);
console.log(`体积：${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
