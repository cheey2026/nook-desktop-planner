using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Nook")]
[assembly: System.Reflection.AssemblyProduct("Nook")]
[assembly: System.Reflection.AssemblyDescription("Nook · 桌面一角的每日计划")]
[assembly: System.Reflection.AssemblyCompany("Nook")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

/// <summary>
/// 启动器：先用干净的环境变量正常启动（保留 Chromium 沙箱），
/// 只有在启动即崩溃时才用 --no-sandbox 重试一次；
/// 两次都失败就弹窗说明原因，避免"双击没反应"没有任何线索。
/// 这样在正常机器上保持沙箱，在受限/高权限环境里也能跑起来。
/// </summary>
static class Launcher
{
    const int CrashBreakpoint = -2147483645; // 0x80000003：Chromium 沙箱初始化失败时的退出码

    [STAThread]
    static void Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string core = Path.Combine(dir, "Nook Core.exe");
        if (!File.Exists(core))
        {
            core = Path.Combine(dir, "electron.exe");
        }
        if (!File.Exists(core))
        {
            ReportFailure(-1, "找不到主程序 Nook Core.exe，请把整个文件夹一起解压/复制，不要单独移动 exe。");
            return;
        }

        string extra = args.Length > 0 ? string.Join(" ", args) : string.Empty;

        Process first = StartCore(core, dir, extra, false);
        if (first == null)
        {
            Process retryOnly = StartCore(core, dir, extra, true);
            if (retryOnly == null)
            {
                ReportFailure(-2, "无法启动 Nook Core.exe，可能是安全软件拦截或文件被移动。");
                return;
            }
            CheckAfterRetry(retryOnly);
            return;
        }

        bool exitedEarly = first.WaitForExit(2000);
        if (!exitedEarly)
        {
            return; // 正常运行中
        }
        if (first.ExitCode == 0)
        {
            return; // 例如已有实例在运行，属于正常退出
        }

        // 启动即崩溃（常见于沙箱无法初始化的环境）→ 关掉沙箱再试一次
        if (first.ExitCode == CrashBreakpoint || first.ExitCode != 0)
        {
            Process retry = StartCore(core, dir, extra, true);
            if (retry == null)
            {
                ReportFailure(first.ExitCode, "关掉沙箱也没能启动。");
                return;
            }
            CheckAfterRetry(retry);
        }
    }

    static void CheckAfterRetry(Process process)
    {
        try
        {
            if (process.WaitForExit(1500) && process.ExitCode != 0)
            {
                ReportFailure(process.ExitCode, "兼容模式和正常模式都没能启动。");
            }
        }
        catch (Exception)
        {
            // 忽略：拿不到退出码就不打扰用户
        }
    }

    static void ReportFailure(int code, string detail)
    {
        try
        {
            string log = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data", "startup.log");
            string hint = File.Exists(log)
                ? "启动日志：data\\startup.log（把最后几行发给作者能更快定位）"
                : "没有找到启动日志，进程可能在加载阶段就被拦下了。";
            MessageBox.Show(
                "Nook 没能启动（错误码 " + code + "）。\r\n\r\n" +
                detail + "\r\n\r\n" +
                "可以先试试：\r\n" +
                "1. 把整个 Nook 文件夹放到 D:\\Nook 这类普通目录再双击 Nook.exe；\r\n" +
                "2. 安全软件（360/火绒/Windows 安全中心）里把 Nook 文件夹加入信任；\r\n" +
                "3. 确认文件夹里同时有 Nook.exe 和 Nook Core.exe。\r\n\r\n" +
                hint,
                "Nook 启动失败",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
        catch (Exception)
        {
            // 连弹窗都不行时安静退出
        }
    }

    static Process StartCore(string core, string dir, string extra, bool disableSandbox)
    {
        var psi = new ProcessStartInfo(core);
        string args = disableSandbox ? "--no-sandbox" : string.Empty;
        if (!string.IsNullOrEmpty(extra))
        {
            args = string.IsNullOrEmpty(args) ? extra : args + " " + extra;
        }
        psi.Arguments = args;
        psi.WorkingDirectory = dir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        try { psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE"); } catch { }

        try
        {
            return Process.Start(psi);
        }
        catch (Exception)
        {
            return null;
        }
    }
}
