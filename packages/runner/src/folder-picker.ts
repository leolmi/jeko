import { run } from './spawn.js';

/** Apre il dialogo di scelta cartella: il percorso scelto, o null se l'utente annulla. */
export type FolderPicker = (opts: { start?: string; title?: string }) => Promise<string | null>;

/**
 * Dialogo moderno di Windows (lo stesso di Esplora risorse: IFileOpenDialog in modalità
 * cartelle), chiamato da PowerShell. Un modulo invisibile e "sempre in primo piano" fa da
 * proprietario, così il dialogo non resta dietro al browser.
 */
export const PICKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JekoFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
  private class FileOpenDialog {}

  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr specs);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr bc, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint form, [MarshalAs(UnmanagedType.LPWStr)] out string name);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(
    string path, IntPtr bc, ref Guid iid, out IShellItem item);

  private const uint FOS_PICKFOLDERS = 0x20;
  private const uint FOS_FORCEFILESYSTEM = 0x40;
  private const uint SIGDN_FILESYSPATH = 0x80058000;

  public static string Pick(string start, string title, IntPtr owner) {
    IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
    uint options;
    dialog.GetOptions(out options);
    dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
    if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
    if (!string.IsNullOrEmpty(start)) {
      try {
        Guid iid = typeof(IShellItem).GUID;
        IShellItem folder;
        SHCreateItemFromParsingName(start, IntPtr.Zero, ref iid, out folder);
        dialog.SetFolder(folder);
      } catch (Exception) { }
    }
    if (dialog.Show(owner) != 0) return null;
    IShellItem result;
    dialog.GetResult(out result);
    string path;
    result.GetDisplayName(SIGDN_FILESYSPATH, out path);
    return path;
  }
}
'@
$owner = New-Object System.Windows.Forms.Form
$owner.FormBorderStyle = 'None'
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0
$owner.StartPosition = 'Manual'
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Location = New-Object System.Drawing.Point([int]($area.X + $area.Width / 2), [int]($area.Y + $area.Height / 3))
$owner.Show()
$owner.Activate()
try {
  $path = [JekoFolderPicker]::Pick($env:JEKO_PICK_START, $env:JEKO_PICK_TITLE, $owner.Handle)
} finally {
  $owner.Close()
}
if ($path) { [Console]::Out.Write($path) }
`;

/** Lo script passa con -EncodedCommand (UTF-16LE in base64): nessun problema di virgolette. */
export const encodeCommand = (script: string) => Buffer.from(script, 'utf16le').toString('base64');
const ENCODED = encodeCommand(PICKER_SCRIPT);

export const windowsFolderPicker: FolderPicker = async ({ start, title }) => {
  const res = await run(
    ['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', ENCODED],
    {
      windowsHide: true,
      env: { ...process.env, JEKO_PICK_START: start ?? '', JEKO_PICK_TITLE: title ?? '' },
    },
  );
  if (res.code !== 0) throw new Error(res.stderr.trim() || `PowerShell è uscito con ${res.code}`);
  return res.stdout.trim() || null;
};
