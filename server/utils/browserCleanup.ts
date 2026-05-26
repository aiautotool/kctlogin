import path from 'path';
import fs from 'fs';

/**
 * Tiện ích dọn dẹp các file lock của Chromium để tránh lỗi "ProcessSingleton".
 * @param profileDir Đường dẫn đến thư mục profile người dùng.
 */
export function cleanupBrowserLock(profileDir: string) {
  const lockFiles = [
    'SingletonLock', // Linux/Mac
    'SingletonCookie',
    'SingletonSocket',
    'parent.lock',    // Firefox
    'lock'           // General
  ];

  // Các thư mục con phổ biến mà file lock có thể ẩn nấp (đặc biệt là trong dự án này)
  const subDirs = ['', 'browser_data', 'Default'];

  for (const subDir of subDirs) {
    const targetDir = path.join(profileDir, subDir);
    
    if (!fs.existsSync(targetDir)) continue;

    for (const file of lockFiles) {
      const lockPath = path.join(targetDir, file);
      try {
        fs.lstatSync(lockPath);
      } catch {
        continue;
      }

      try {
        console.log(`[Cleanup] Dang xoa file lock: ${lockPath}`);
        fs.unlinkSync(lockPath);
      } catch (e: any) {
        console.warn(`[Cleanup] Khong the xoa file lock ${file} tai ${subDir || 'root'}: ${e.message}`);
      }
    }
  }

  const removeNestedLocks = (dir: string, depth = 0) => {
    if (depth > 5 || !fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        removeNestedLocks(entryPath, depth + 1);
      } else if (entry.name === 'LOCK') {
        try {
          console.log(`[Cleanup] Dang xoa file lock: ${entryPath}`);
          fs.unlinkSync(entryPath);
        } catch (e: any) {
          console.warn(`[Cleanup] Khong the xoa file lock ${entryPath}: ${e.message}`);
        }
      }
    }
  };

  removeNestedLocks(profileDir);
}
