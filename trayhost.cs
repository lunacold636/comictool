using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
using Timer = System.Windows.Forms.Timer;

// 漫画标签库 托盘宿主
// 双击 / 开机自启动时以本程序常驻托盘：隐藏启动 node server.js（NO_OPEN=1，不自动弹浏览器），
// 托盘左键 = 打开浏览器，右键菜单 = 打开 / 开机自启动 / 启动服务 / 退出。
// 编译：build-tray.bat（系统自带 csc.exe，.NET Framework 4.x，无需额外依赖）
static class TrayProgram
{
    const int PORT = 38417;
    const string URL = "http://127.0.0.1:38417/";
    const string MUTEX_NAME = "ComicTagLibraryTray_38417";
    const string RUN_KEY = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RUN_NAME = "漫画标签库";

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length > 0)
        {
            string a = args[0].ToLowerInvariant();
            if (a == "--autostart-on") { Autostart.Set(true); return; }
            if (a == "--autostart-off") { Autostart.Set(false); return; }
        }

        bool createdNew;
        using (Mutex m = new Mutex(true, MUTEX_NAME, out createdNew))
        {
            if (!createdNew) return; // 已有实例在跑
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (TrayApp app = new TrayApp())
            {
                Application.Run();
            }
        }
    }

    // ---------- 开机自启动（当前用户 HKCU Run） ----------
    static class Autostart
    {
        public static string ExePath
        {
            get { return "\"" + Application.ExecutablePath + "\""; }
        }
        public static bool IsEnabled()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RUN_KEY, false))
                {
                    if (k == null) return false;
                    object v = k.GetValue(RUN_NAME);
                    return v is string && string.Equals((string)v, ExePath, StringComparison.OrdinalIgnoreCase);
                }
            }
            catch { return false; }
        }
        public static void Set(bool on)
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RUN_KEY, true))
                {
                    if (k == null) return;
                    if (on) k.SetValue(RUN_NAME, ExePath);
                    else k.DeleteValue(RUN_NAME, false);
                }
            }
            catch { }
        }
    }

    // ---------- 托盘应用 ----------
    class TrayApp : Form
    {
        NotifyIcon _icon;
        ContextMenuStrip _menu;
        ToolStripMenuItem _autoItem;
        ToolStripMenuItem _startItem;
        Process _nodeProc;
        string _baseDir;
        string _serverJs;
        string _nodeExe;
        bool _spawnedByUs;
        Timer _timer;

        public TrayApp()
        {
            Text = "漫画标签库";
            ShowInTaskbar = false;

            _baseDir = AppDomain.CurrentDomain.BaseDirectory;
            _serverJs = Path.Combine(_baseDir, "server.js");
            _nodeExe = FindNode();

            _icon = new NotifyIcon();
            _icon.Icon = MakeIcon();
            _icon.Text = "漫画标签库";
            _icon.Visible = true;
            _icon.DoubleClick += delegate { OpenBrowser(); };

            _menu = new ContextMenuStrip();
            _menu.Items.Add("打开漫画库", null, delegate { OpenBrowser(); });
            _autoItem = new ToolStripMenuItem("开机自启动", null, delegate { ToggleAutostart(); });
            _startItem = new ToolStripMenuItem("启动服务", null, delegate { StartServer(); });
            _menu.Items.Add(_autoItem);
            _menu.Items.Add(_startItem);
            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add("退出", null, delegate { Quit(); });
            _icon.ContextMenuStrip = _menu;

            _autoItem.Checked = Autostart.IsEnabled();
            StartServer();

            _timer = new Timer();
            _timer.Interval = 3000;
            _timer.Tick += delegate { CheckServer(); };
            _timer.Start();
        }

        void OpenBrowser()
        {
            try { Process.Start(URL); }
            catch { }
        }

        void ToggleAutostart()
        {
            bool on = !_autoItem.Checked;
            Autostart.Set(on);
            _autoItem.Checked = on;
            _icon.ShowBalloonTip(2000, "漫画标签库", on ? "已开启开机自启动" : "已关闭开机自启动", ToolTipIcon.Info);
        }

        void StartServer()
        {
            if (_nodeProc != null)
            {
                try { if (!_nodeProc.HasExited) return; } catch { }
                _nodeProc = null;
            }
            if (IsPortInUse())
            {
                _spawnedByUs = false;
                _startItem.Enabled = false;
                _icon.ShowBalloonTip(2000, "漫画标签库", "服务已在运行（端口 " + PORT + "），点托盘图标打开", ToolTipIcon.Info);
                return;
            }
            if (!File.Exists(_serverJs))
            {
                _icon.ShowBalloonTip(3000, "漫画标签库", "未找到 server.js，请确认它与 ComicTray.exe 在同一目录", ToolTipIcon.Error);
                return;
            }
            if (_nodeExe == null)
            {
                _icon.ShowBalloonTip(3000, "漫画标签库", "未找到 Node.js（node.exe），请先安装", ToolTipIcon.Error);
                return;
            }
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = _nodeExe;
                psi.Arguments = "\"" + _serverJs + "\"";
                psi.WorkingDirectory = _baseDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                psi.EnvironmentVariables["NO_OPEN"] = "1";
                _nodeProc = Process.Start(psi);
                _spawnedByUs = true;
                _startItem.Enabled = false;
                _icon.ShowBalloonTip(2000, "漫画标签库", "服务已启动，点托盘图标打开漫画库", ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                _icon.ShowBalloonTip(3000, "漫画标签库", "启动服务失败：" + ex.Message, ToolTipIcon.Error);
            }
        }

        void CheckServer()
        {
            if (_nodeProc == null) return;
            try
            {
                if (_nodeProc.HasExited)
                {
                    _nodeProc = null;
                    _startItem.Enabled = true;
                    _icon.ShowBalloonTip(3000, "漫画标签库", "漫画服务已停止，可点右键「启动服务」重启", ToolTipIcon.Warning);
                }
            }
            catch { }
        }

        void Quit()
        {
            _timer.Stop();
            _icon.Visible = false;
            if (_nodeProc != null && _spawnedByUs)
            {
                try { if (!_nodeProc.HasExited) _nodeProc.Kill(); } catch { }
            }
            Application.Exit();
        }
    }

    // ---------- 工具 ----------
    static bool IsPortInUse()
    {
        try
        {
            using (TcpClient c = new TcpClient())
            {
                c.Connect("127.0.0.1", PORT);
                return true;
            }
        }
        catch { return false; }
    }

    static string FindNode()
    {
        string[] candidates = new string[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
        };
        foreach (string c in candidates)
        {
            try { if (File.Exists(c)) return c; } catch { }
        }
        string pathVar = Environment.GetEnvironmentVariable("PATH");
        if (pathVar != null)
        {
            foreach (string dir in pathVar.Split(Path.PathSeparator))
            {
                try
                {
                    string p = Path.Combine(dir.Trim('"'), "node.exe");
                    if (File.Exists(p)) return p;
                }
                catch { }
            }
        }
        return null;
    }

    static Icon MakeIcon()
    {
        using (Bitmap bmp = new Bitmap(32, 32))
        {
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using (GraphicsPath gp = RoundedRect(new Rectangle(1, 1, 30, 30), 7))
                using (SolidBrush brush = new SolidBrush(Color.FromArgb(79, 110, 247)))
                {
                    g.FillPath(brush, gp);
                }
                using (Font f = new Font("Microsoft YaHei", 15f, FontStyle.Bold, GraphicsUnit.Pixel))
                using (SolidBrush w = new SolidBrush(Color.White))
                {
                    SizeF sz = g.MeasureString("书", f);
                    g.DrawString("书", f, w, (32f - sz.Width) / 2f, (32f - sz.Height) / 2f - 1f);
                }
            }
            IntPtr h = bmp.GetHicon();
            try
            {
                using (Icon ic = Icon.FromHandle(h))
                {
                    return (Icon)ic.Clone();
                }
            }
            finally
            {
                DestroyIcon(h);
            }
        }
    }

    static GraphicsPath RoundedRect(Rectangle r, int radius)
    {
        int d = radius * 2;
        GraphicsPath p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr handle);
}