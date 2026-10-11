; Printer OBS Overlay – Windows-Installer (Inno Setup 6)
; Bauen: npm run build:installer  (setzt AppVersion und das Ausgabeverzeichnis)

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "Printer OBS Overlay"
#define AppExe "printer-overlay.exe"
#define Root "..\.."

[Setup]
AppId={{6E1C2B9A-4F0D-4C55-9C21-3B7D2E8A51F4}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=N3DP
AppPublisherURL=https://github.com/NilsN3DP/printer-obs-overlay
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=PrinterOBSOverlay-Setup-{#AppVersion}
SetupIconFile={#Root}\packaging\windows\app.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
de.CompApp=Windows-App (Dashboard und Overlay-Server)
en.CompApp=Windows app (dashboard and overlay server)
de.CompObs=OBS-Plugin (Quelle "Printer Overlay" direkt in OBS)
en.CompObs=OBS plugin ("Printer Overlay" source inside OBS)
de.TaskAutostart=Beim Anmelden automatisch im Hintergrund starten
en.TaskAutostart=Start automatically in the background at sign-in
de.LaunchApp=Dashboard jetzt öffnen
en.LaunchApp=Open dashboard now

[Types]
Name: "full"; Description: "{cm:CompApp} + {cm:CompObs}"
Name: "custom"; Description: "Custom"; Flags: iscustom

[Components]
Name: "app"; Description: "{cm:CompApp}"; Types: full custom
Name: "obs"; Description: "{cm:CompObs}"; Types: full custom

[Tasks]
Name: "autostart"; Description: "{cm:TaskAutostart}"; Components: app; Flags: unchecked
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Components: app; Flags: unchecked

[Files]
Source: "{#Root}\dist\{#AppExe}"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "{#Root}\dist\obs-plugin\printer-overlay\*"; DestDir: "{commonappdata}\obs-studio\plugins\printer-overlay"; Components: obs; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; conhost --headless: kein Konsolenfenster; die App oeffnet das Dashboard im Browser.
Name: "{group}\{#AppName}"; Filename: "{sys}\conhost.exe"; Parameters: "--headless ""{app}\{#AppExe}"""; IconFilename: "{app}\{#AppExe}"; Components: app
Name: "{autodesktop}\{#AppName}"; Filename: "{sys}\conhost.exe"; Parameters: "--headless ""{app}\{#AppExe}"""; IconFilename: "{app}\{#AppExe}"; Components: app; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "PrinterOBSOverlay"; ValueData: "conhost.exe --headless ""{app}\{#AppExe}"" --background"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{sys}\conhost.exe"; Parameters: "--headless ""{app}\{#AppExe}"""; Description: "{cm:LaunchApp}"; Components: app; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM {#AppExe}"; Flags: runhidden; RunOnceId: "StopServer"

[UninstallDelete]
Type: dirifempty; Name: "{commonappdata}\obs-studio\plugins\printer-overlay"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  { Autostart-Eintrag auch entfernen, wenn er ueber das Dashboard gesetzt wurde. }
  if CurUninstallStep = usPostUninstall then
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'PrinterOBSOverlay');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  { Laufende App beenden, damit die Exe ersetzt werden kann. }
  if CurStep = ssInstall then
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
