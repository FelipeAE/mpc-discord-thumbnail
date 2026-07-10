import { execFile } from 'child_process';
import Logger from './logger';

/**
 * Muestra una notificación nativa de Windows (Balloon Tip) sin usar dependencias externas
 * @param title Título de la notificación
 * @param message Cuerpo del mensaje
 */
export function showWindowsNotification(title: string, message: string): void {
  const escapedTitle = title.replace(/"/g, '`"');
  const escapedMessage = message.replace(/"/g, '`"');
  
  const command = `
    [void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');
    $notification = New-Object System.Windows.Forms.NotifyIcon;
    $notification.Icon = [System.Drawing.SystemIcons]::Information;
    $notification.BalloonTipIcon = 'Info';
    $notification.BalloonTipTitle = "${escapedTitle}";
    $notification.BalloonTipText = "${escapedMessage}";
    $notification.Visible = $true;
    $notification.ShowBalloonTip(5000);
  `.replace(/\s+/g, ' ').trim();

  execFile(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
    { windowsHide: true },
    (error) => {
      if (error) {
        Logger.debug(`Error al mostrar notificación de Windows: ${error.message}`);
      }
    }
  );
}
