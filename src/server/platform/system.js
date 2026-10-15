// Dashboard im Standardbrowser oeffnen (npm run dev -- --open).
import { spawn } from 'node:child_process';

export function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // ohne Browser geht es auch – die URL steht im Log
  }
}
