using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

[assembly: ComVisible(false)]
[assembly: System.Reflection.AssemblyTitle("WPS High School Math Native Dialog Probe")]
[assembly: System.Reflection.AssemblyDescription("Internal in-process COM dialog probe for WPS Writer and Presentation")]
[assembly: System.Reflection.AssemblyCompany("WpsHighSchoolMath Internal Probe")]
[assembly: System.Reflection.AssemblyProduct("WpsHsmNativeDialogProbe")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]

namespace WpsHsmNativeDialogProbe
{
    public enum ExtConnectMode
    {
        AfterStartup = 0,
        Startup = 1,
        External = 2,
        CommandLine = 3
    }

    public enum ExtDisconnectMode
    {
        HostShutdown = 0,
        UserClosed = 1
    }

    [ComVisible(true)]
    [Guid("B65AD801-ABAF-11D0-BB8B-00A0C90F2744")]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface IDTExtensibility2
    {
        [DispId(1)]
        void OnConnection(
            [MarshalAs(UnmanagedType.IDispatch)] object application,
            ExtConnectMode connectMode,
            [MarshalAs(UnmanagedType.IDispatch)] object addInInstance,
            ref Array custom);

        [DispId(2)]
        void OnDisconnection(ExtDisconnectMode removeMode, ref Array custom);

        [DispId(3)]
        void OnAddInsUpdate(ref Array custom);

        [DispId(4)]
        void OnStartupComplete(ref Array custom);

        [DispId(5)]
        void OnBeginShutdown(ref Array custom);
    }

    [ComVisible(true)]
    [Guid("D34D2D75-E6AD-4E16-9050-68A34C3032C4")]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface IWpsHsmNativeDialogProbe
    {
        [DispId(1)]
        string GetBridgeVersion();

        [DispId(2)]
        int GetProcessId();

        [DispId(3)]
        string GetProcessName();

        [DispId(4)]
        int ShowInputDialog(string title, string prompt, string defaultValue, int maxLength);

        [DispId(5)]
        string GetLastResult();

        [DispId(6)]
        int GetLastResultLength();

        [DispId(7)]
        void ClearResult();

        [DispId(8)]
        string GetLastError();
    }

    [ComVisible(true)]
    [Guid("76F85F17-71B3-40E2-A4CD-50B769FA37A7")]
    [ProgId("WpsHsm.NativeDialogProbe")]
    [ClassInterface(ClassInterfaceType.None)]
    [ComDefaultInterface(typeof(IWpsHsmNativeDialogProbe))]
    public sealed class AddIn : IDTExtensibility2, IWpsHsmNativeDialogProbe
    {
        private object application;
        private object addInInstance;
        private string lastResult = String.Empty;
        private string lastError = String.Empty;

        public void OnConnection(object hostApplication, ExtConnectMode connectMode, object hostAddInInstance, ref Array custom)
        {
            application = hostApplication;
            addInInstance = hostAddInInstance;
            lastError = String.Empty;
            TryPublishAutomationObject();
        }

        public void OnDisconnection(ExtDisconnectMode removeMode, ref Array custom)
        {
            ClearResult();
            ReleaseComReference(addInInstance);
            ReleaseComReference(application);
            addInInstance = null;
            application = null;
        }

        public void OnAddInsUpdate(ref Array custom)
        {
        }

        public void OnStartupComplete(ref Array custom)
        {
            TryPublishAutomationObject();
        }

        public void OnBeginShutdown(ref Array custom)
        {
            ClearResult();
        }

        public string GetBridgeVersion()
        {
            return "1.0-com";
        }

        public int GetProcessId()
        {
            return Process.GetCurrentProcess().Id;
        }

        public string GetProcessName()
        {
            return Process.GetCurrentProcess().ProcessName;
        }

        public int ShowInputDialog(string title, string prompt, string defaultValue, int maxLength)
        {
            ClearResult();
            lastError = String.Empty;
            try
            {
                int safeMaxLength = Math.Max(1, Math.Min(maxLength, 32767));
                using (NativeInputForm dialog = new NativeInputForm(title, prompt, defaultValue, safeMaxLength))
                {
                    IntPtr hostWindow = GetHostWindowHandle();
                    DialogResult result = hostWindow == IntPtr.Zero
                        ? dialog.ShowDialog()
                        : dialog.ShowDialog(new WindowHandle(hostWindow));
                    if (result != DialogResult.OK)
                    {
                        ClearResult();
                        return 0;
                    }
                    lastResult = dialog.Value;
                    return 1;
                }
            }
            catch (Exception error)
            {
                ClearResult();
                lastError = error.GetType().Name + ": " + error.Message;
                return -1;
            }
        }

        public string GetLastResult()
        {
            return lastResult;
        }

        public int GetLastResultLength()
        {
            return lastResult == null ? 0 : lastResult.Length;
        }

        public void ClearResult()
        {
            lastResult = String.Empty;
        }

        public string GetLastError()
        {
            return lastError;
        }

        private void TryPublishAutomationObject()
        {
            if (addInInstance == null)
            {
                return;
            }
            try
            {
                addInInstance.GetType().InvokeMember(
                    "Object",
                    BindingFlags.SetProperty | BindingFlags.Public | BindingFlags.Instance,
                    null,
                    addInInstance,
                    new object[] { this },
                    CultureInfo.InvariantCulture);
            }
            catch (Exception error)
            {
                lastError = "COMAddIn.Object publication failed: " + error.GetType().Name;
            }
        }

        private IntPtr GetHostWindowHandle()
        {
            if (application == null)
            {
                return IntPtr.Zero;
            }
            try
            {
                object raw = application.GetType().InvokeMember(
                    "Hwnd",
                    BindingFlags.GetProperty | BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase,
                    null,
                    application,
                    null,
                    CultureInfo.InvariantCulture);
                return new IntPtr(Convert.ToInt64(raw, CultureInfo.InvariantCulture));
            }
            catch
            {
                return IntPtr.Zero;
            }
        }

        private static void ReleaseComReference(object value)
        {
            if (value == null || !Marshal.IsComObject(value))
            {
                return;
            }
            try
            {
                Marshal.FinalReleaseComObject(value);
            }
            catch
            {
            }
        }
    }

    internal sealed class WindowHandle : IWin32Window
    {
        private readonly IntPtr handle;

        public WindowHandle(IntPtr handleValue)
        {
            handle = handleValue;
        }

        public IntPtr Handle
        {
            get { return handle; }
        }
    }

    internal sealed class NativeInputForm : Form
    {
        private readonly TextBox input;

        public NativeInputForm(string title, string prompt, string defaultValue, int maxLength)
        {
            Text = String.IsNullOrWhiteSpace(title) ? "高中数学工具" : title;
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point, 134);
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MinimizeBox = false;
            MaximizeBox = false;
            ShowIcon = false;
            ShowInTaskbar = false;
            ClientSize = new Size(560, 310);

            Label promptLabel = new Label();
            promptLabel.AutoSize = false;
            promptLabel.Location = new Point(18, 18);
            promptLabel.Size = new Size(524, 48);
            promptLabel.Text = prompt ?? String.Empty;

            input = new TextBox();
            input.Location = new Point(18, 72);
            input.Size = new Size(524, 176);
            input.Multiline = true;
            input.AcceptsReturn = true;
            input.AcceptsTab = false;
            input.ScrollBars = ScrollBars.Vertical;
            input.MaxLength = maxLength;
            input.Text = defaultValue ?? String.Empty;

            Button ok = new Button();
            ok.Location = new Point(366, 264);
            ok.Size = new Size(84, 30);
            ok.Text = "确定";
            ok.DialogResult = DialogResult.OK;

            Button cancel = new Button();
            cancel.Location = new Point(458, 264);
            cancel.Size = new Size(84, 30);
            cancel.Text = "取消";
            cancel.DialogResult = DialogResult.Cancel;

            Controls.Add(promptLabel);
            Controls.Add(input);
            Controls.Add(ok);
            Controls.Add(cancel);
            AcceptButton = ok;
            CancelButton = cancel;
            Shown += delegate
            {
                input.Focus();
                input.SelectionStart = input.TextLength;
            };
        }

        public string Value
        {
            get { return input.Text; }
        }
    }
}
