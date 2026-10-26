'use strict';

/**
 * 打一个可以直接发给别人的绿色压缩包：
 *   share/Nook-<版本>-win64.zip
 *
 * 包里是全新的程序目录：不含本机数据、快捷方式、自启动项，
 * 别人解压到任意位置双击 Nook.exe 就能用。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const staging = path.join(ROOT, '.share-build');
const shareDir = path.join(ROOT, 'share');
const zipName = `Nook-${version}-win64.zip`;
const zipPath = path.join(shareDir, zipName);

console.log(`准备构建 Nook ${version} 到临时目录…`);
fs.rmSync(staging, { recursive: true, force: true });

const build = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build_portable.js')], {
  env: { ...process.env, NOOK_OUT: staging, NOOK_SKIP_RUNNING_CHECK: '1' },
  stdio: 'inherit'
});
if (build.status !== 0) {
  console.error('构建失败，未生成压缩包。');
  process.exit(1);
}

// 去掉只属于本机的东西
for (const name of ['data', 'startup.log', '.tmp-data-backup']) {
  fs.rmSync(path.join(staging, name), { recursive: true, force: true });
}

const readme = `Nook · 桌面一角的每日计划（${version}，64 位 Windows）

【怎么用】
1. 解压到任意目录，建议 D:\\Nook 或 C:\\Users\\你的用户名\\Nook；
   不要放在 C:\\Program Files 这类可能需要管理员权限的位置。
2. 双击 Nook.exe 启动。同一个文件夹里的 Nook Core.exe 是内核，不要单独双击，也不要删除。
3. 第一次运行 Windows 可能提示「已保护你的电脑」：点「更多信息」→「仍要运行」（程序没有买代码签名证书）。

【数据在哪】
- 任务和设置都在程序目录的 data 文件夹里（data\\plans.json），不联网、不上传。
- 整个文件夹复制走就等于备份/迁移。

【常用设置】
- 设置 → 窗口与启动：开机自启动、组件是否显示在最上层。
- 设置 → 外观与尺寸：组件宽度/高度、不透明度、字号、主题色。
- 右键桌面组件：置顶、高度自适应、打开计划表、退出。

【双击没反应怎么办】
- 看 data\\startup.log 里有没有新的启动记录：
  没有记录 = 进程被安全软件挡住了，把整个文件夹加进信任列表；
  有记录 = 把最后几行发给我。
- 程序自带启动器：会先按正常方式启动，若立刻崩溃会自动改用兼容模式再启动一次。

需要 64 位 Windows 10 或 11。
`;

fs.writeFileSync(path.join(staging, '先读我.txt'), readme, 'utf8');

console.log('压缩中…（约 270MB，需要一会儿）');
fs.mkdirSync(shareDir, { recursive: true });
fs.rmSync(zipPath, { force: true });

const zip = spawnSync('tar.exe', ['-a', '-c', '-f', zipPath, '-C', staging, '.'], { stdio: 'inherit' });
if (zip.status !== 0 || !fs.existsSync(zipPath)) {
  console.error('压缩失败。可以先手动打包临时目录：', staging);
  process.exit(1);
}

const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`完成：${zipPath}（${sizeMb} MB）`);
console.log('把整个 .zip 发给对方即可，对方解压后双击 Nook.exe。');
