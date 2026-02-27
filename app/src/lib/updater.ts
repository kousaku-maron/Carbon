import { ask, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

let checkedOnce = false;

export async function checkForAppUpdatesOnStartup() {
  if (checkedOnce || import.meta.env.DEV) {
    return;
  }
  checkedOnce = true;

  try {
    const update = await check();
    if (!update) {
      return;
    }

    const shouldInstall = await ask(
      `Version ${update.version} is available. Install now?`,
      {
        title: "Update available",
        kind: "info",
      },
    );
    if (!shouldInstall) {
      await update.close();
      return;
    }

    try {
      await update.downloadAndInstall();
    } finally {
      await update.close();
    }

    const shouldRestart = await ask(
      "The update was installed. Restart Carbon now?",
      {
        title: "Update installed",
        kind: "info",
      },
    );
    if (shouldRestart) {
      await relaunch();
      return;
    }

    await message("Restart Carbon later to use the new version.", {
      title: "Restart required",
      kind: "info",
    });
  } catch (error) {
    console.error("Auto-update check failed", error);
  }
}
