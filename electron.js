import { app, BrowserWindow, Menu, Tray, nativeImage, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;
const appIcon = isDev
  ? path.join(__dirname, 'public', 'app-icon.png')
  : path.join(__dirname, 'dist', 'app-icon.png');

let mainWindow = null;
let tray = null;
let trayWindow = null;
let isQuitting = false;

function configureMacAppShell() {
  if (process.platform !== 'darwin') return;

  // Keep the main app visible in Dock and App Switcher.
  app.setActivationPolicy('regular');
  app.dock.show();

  const dockIcon = nativeImage.createFromPath(appIcon);
  if (!dockIcon.isEmpty()) {
    app.dock.setIcon(dockIcon);
  }
}

function configureRuntimePaths() {
  process.env.KCT_APP_ROOT = __dirname;
  process.env.KCT_DATA_DIR = process.env.KCT_DATA_DIR || path.join(app.getPath('userData'), 'server-data');
  process.env.KCT_RESOURCES_PATH = process.env.KCT_RESOURCES_PATH || (app.isPackaged ? process.resourcesPath : __dirname);
}

function getAppUrl(search = '') {
  const baseUrl = isDev
    ? 'http://localhost:5174'
    : 'http://127.0.0.1:3002';
  return `${baseUrl}${search}`;
}

function getTrayIcon() {
  const icon = nativeImage.createFromPath(appIcon).resize({ width: 18, height: 18 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

function createWindow() {
  if (mainWindow) return mainWindow;

  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    title: 'KCT Login',
    backgroundColor: '#030712',
    icon: appIcon,
    show: false,
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(getAppUrl());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.minimize();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function positionTrayWindow() {
  if (!tray || !trayWindow) return;
  const trayBounds = tray.getBounds();
  const windowBounds = trayWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2),
  });
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  const y = process.platform === 'darwin'
    ? Math.round(trayBounds.y + trayBounds.height + 6)
    : Math.round(trayBounds.y - windowBounds.height - 6);

  trayWindow.setPosition(
    Math.min(Math.max(x, display.workArea.x + 8), display.workArea.x + display.workArea.width - windowBounds.width - 8),
    Math.min(Math.max(y, display.workArea.y + 8), display.workArea.y + display.workArea.height - windowBounds.height - 8),
    false,
  );
}

function createTrayWindow() {
  if (trayWindow) return trayWindow;

  trayWindow = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 420,
    minHeight: 560,
    title: 'Remove Gemini Logo',
    backgroundColor: '#030712',
    icon: appIcon,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.platform === 'darwin') {
    trayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  trayWindow.loadURL(getAppUrl('/?tray=removeLogo'));
  trayWindow.on('blur', () => {
    if (!trayWindow?.webContents.isDevToolsOpened()) trayWindow?.hide();
  });
  trayWindow.on('closed', () => {
    trayWindow = null;
  });

  return trayWindow;
}

function showMainWindow() {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (process.platform === 'darwin') app.dock.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleTrayWindow() {
  if (!trayWindow) createTrayWindow();
  if (!trayWindow) return;

  if (trayWindow.isVisible()) {
    trayWindow.hide();
    return;
  }

  positionTrayWindow();
  trayWindow.show();
  trayWindow.focus();
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('KCT Remove Gemini Logo');
  tray.on('click', toggleTrayWindow);
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Remove Gemini Logo', click: toggleTrayWindow },
      {
        label: 'Open KCT Login',
        click: showMainWindow,
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray?.popUpContextMenu(menu);
  });
  createTrayWindow();
}

app.whenReady().then(async () => {
  configureMacAppShell();
  configureRuntimePaths();
  if (app.isPackaged) {
    await import(`file://${path.join(__dirname, 'dist-server', 'index.js')}`);
  }
  createWindow();
  createTray();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  showMainWindow();
});
