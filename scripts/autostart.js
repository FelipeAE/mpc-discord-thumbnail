const fs = require('fs');
const path = require('path');

const startupDir = path.join(
  process.env.APPDATA,
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup'
);
const shortcutFile = path.join(startupDir, 'mpc-discord-presence.bat');
const projectDir = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const command = args[0];

if (command === '--install') {
  const batContent = `@echo off\ncd /d "${projectDir}"\nnpm start\n`;
  try {
    fs.writeFileSync(shortcutFile, batContent, 'utf8');
    console.log(`[Auto-start] Instalado exitosamente.`);
    console.log(`[Auto-start] Archivo creado en: ${shortcutFile}`);
  } catch (error) {
    console.error(`[Auto-start] Error al instalar: ${error.message}`);
    process.exit(1);
  }
} else if (command === '--remove') {
  try {
    if (fs.existsSync(shortcutFile)) {
      fs.unlinkSync(shortcutFile);
      console.log(`[Auto-start] Removido exitosamente.`);
    } else {
      console.log(`[Auto-start] No estaba instalado.`);
    }
  } catch (error) {
    console.error(`[Auto-start] Error al remover: ${error.message}`);
    process.exit(1);
  }
} else {
  console.log('Uso: node autostart.js [--install | --remove]');
  process.exit(1);
}
