; Дополнение к установщику Расхламителя.
; При удалении программы убираем задание-напоминание из Планировщика Windows,
; чтобы не оставлять хвостов. При обновлении не трогаем — программа сама пересоздаст задание.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec 'schtasks /Delete /TN "Rashlamitel Reminder" /F'
  ${endIf}
!macroend
