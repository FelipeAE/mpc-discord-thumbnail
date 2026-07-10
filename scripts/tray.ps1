param (
    [int]$NodePid,
    [string]$LogPath,
    [string]$HistoryPath
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Crear el ícono de la bandeja de sistema
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon

# Usar el ícono de información predeterminado de Windows
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "MPC Discord Presence"
$notifyIcon.Visible = $true

# Crear el menú contextual
$contextMenu = New-Object System.Windows.Forms.ContextMenu
$menuItemTitle = New-Object System.Windows.Forms.MenuItem("MPC Discord Presence (Activo)")
$menuItemTitle.Enabled = $false
$menuItemSeparator = New-Object System.Windows.Forms.MenuItem("-")
$menuItemLogs = New-Object System.Windows.Forms.MenuItem("Ver Logs")
$menuItemHistory = New-Object System.Windows.Forms.MenuItem("Ver Historial")
$menuItemExit = New-Object System.Windows.Forms.MenuItem("Salir")

$contextMenu.MenuItems.AddRange(@($menuItemTitle, $menuItemSeparator, $menuItemLogs, $menuItemHistory, $menuItemExit))
$notifyIcon.ContextMenu = $contextMenu

# Evento para abrir Logs
$menuItemLogs.add_Click({
    if (Test-Path $LogPath) {
        Start-Process notepad.exe -ArgumentList $LogPath
    } else {
        [System.Windows.Forms.MessageBox]::Show("El archivo de logs no existe aún.", "MPC Discord Presence")
    }
})

# Evento para abrir Historial
$menuItemHistory.add_Click({
    if (Test-Path $HistoryPath) {
        Start-Process notepad.exe -ArgumentList $HistoryPath
    } else {
        [System.Windows.Forms.MessageBox]::Show("El archivo de historial no existe aún (reproduce un video primero).", "MPC Discord Presence")
    }
})

# Evento para Salir (cierra la bandeja y detiene la aplicación Node.js)
$menuItemExit.add_Click({
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    if ($NodePid -gt 0) {
        Stop-Process -Id $NodePid -Force
    }
    [System.Windows.Forms.Application]::Exit()
    exit
})

# Ejecutar el loop de mensaje de aplicación de Windows Forms para mantener el ícono en bandeja
[System.Windows.Forms.Application]::Run()
