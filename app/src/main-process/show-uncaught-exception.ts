import { app, dialog } from 'electron'
import { formatError } from '../lib/logging/format-error'
import { CrashWindow } from './crash-window'
import { setCrashMenu } from './menu'

let hasReportedUncaughtException = false

/** Show the uncaught exception UI. */
export function showUncaughtException(isLaunchError: boolean, error: Error) {
  log.error(formatError(error))

  if (hasReportedUncaughtException) {
    return
  }

  hasReportedUncaughtException = true

  setCrashMenu()

  const window = new CrashWindow(isLaunchError ? 'launch' : 'generic', error)

  window.onDidLoad(() => {
    window.show()
  })

  window.onFailedToLoad(async () => {
    await dialog.showMessageBox({
      type: 'error',
      title: __DARWIN__ ? `Unrecoverable Error` : 'Unrecoverable error',
      message:
        `Git Desktop has encountered an unrecoverable error and will need to restart.\n\n` +
        `This has been reported to the team, but if you encounter this repeatedly please report ` +
        `this issue to the Git Desktop issue tracker.\n\n${
          error.stack || error.message
        }`,
    })

    if (!__DEV__) {
      app.relaunch()
    }
    app.quit()
  })

  window.onClose(() => {
    if (!__DEV__) {
      app.relaunch()
    }
    app.quit()
  })

  window.load()
}
