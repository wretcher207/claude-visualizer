; Runs as the uninstaller starts, before the app's files go: takes the app's
; hook entries out of Claude Code's settings (see src/connection.rs).
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --disconnect'
!macroend
