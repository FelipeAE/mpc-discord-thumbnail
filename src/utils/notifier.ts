import notifier from 'node-notifier';
import Logger from './logger';

/**
 * Muestra una notificación nativa de Windows (Toast) usando node-notifier
 * @param title Título de la notificación
 * @param message Cuerpo del mensaje
 */
export function showWindowsNotification(title: string, message: string): void {
  notifier.notify(
    {
      title: title,
      message: message,
      appID: 'MPC Discord RPC',
      wait: false
    },
    (error) => {
      if (error) {
        Logger.debug(`Error al mostrar notificación de Windows: ${error.message}`);
      }
    }
  );
}
