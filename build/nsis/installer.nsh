!macro customInit
  ; --- Upgrade marker ---------------------------------------------------------
  ; Файл рядом с LAZEYKA.exe, помечающий «это обновление, а не первая
  ; установка». Пишется только если в реестре уже есть запись об установке.
  ;
  ; Ничего критичного на нём не держится: деинсталлятор и так не трогает
  ; %APPDATA%\lazeyka, настройки переживают обновление в любом случае. Маркер
  ; остаётся как след для диагностики — по нему видно, что каталог переписали
  ; апгрейдом, а не поставили заново.
  ReadRegStr $0 SHCTX "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  StrCmp $0 "" custominit_done 0
  FileOpen $1 "$0\.lazeyka-upgrade" w
  IfErrors custominit_done
  FileWrite $1 "customInit-marker$\r$\n"
  FileClose $1
  custominit_done:
!macroend

!macro customInstall
  ; --- Programs & Features registry overrides --------------------------------
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "Publisher" "LAZEYKA"
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "Comments" "reb0oorn"

  ; Ensure the icon shown next to LAZEYKA in P&F is our fresh icon
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "$INSTDIR\resources\icon.ico"

  DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY}" "URLInfoAbout"
  DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY}" "HelpLink"
  DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY}" "URLUpdateInfo"

  DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY}" "VersionMajor"
  DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY}" "VersionMinor"
  DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY}" "Version"
!macroend

!macro customUnInstall
  ; 1. Stop running processes
  nsExec::ExecToLog 'taskkill /F /IM LAZEYKA.exe /T'
  nsExec::ExecToLog 'taskkill /F /IM TgWsProxy_windows.exe /T'
  nsExec::ExecToLog 'taskkill /F /IM winws.exe /T'
  nsExec::ExecToLog 'taskkill /F /IM sing-box.exe /T'
  nsExec::ExecToLog 'taskkill /F /IM xray.exe /T'
  nsExec::ExecToLog 'taskkill /F /IM elevate.exe /T'
  Sleep 500

  ; 2. Remove scheduled tasks
  nsExec::ExecToLog 'schtasks /delete /tn "LazeykaAutoStart" /f'

  ; 3. Remove run keys
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LAZEYKA"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "LAZEYKA"

  ; 4. Remove URI schemes
  DeleteRegKey HKCR "lazeyka"
  DeleteRegKey HKCR "tg-ws"
  DeleteRegKey HKCU "Software\Classes\lazeyka"
  DeleteRegKey HKCU "Software\Classes\tg-ws"

  ; 5. Clean install directory
  RMDir /r "$INSTDIR"
!macroend
