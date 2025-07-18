import * as React from 'react'

import { Disposable } from 'event-kit'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  OkCancelButtonGroup,
} from '../dialog'
import { Dispatcher } from '../dispatcher'
import { Row } from '../lib/row'
import { IUpdateState, UpdateStatus, updateStore } from '../lib/update-store'

interface IInstallingUpdateProps {
  /**
   * Event triggered when the dialog is dismissed by the user in the
   * ways described in the Dialog component's dismissable prop.
   */
  readonly onDismissed: () => void

  readonly dispatcher: Dispatcher
}

/**
 * A dialog that presents information about the
 * running application such as name and version.
 */
export class InstallingUpdate extends React.Component<IInstallingUpdateProps> {
  private updateStoreEventHandle: Disposable | null = null

  private onUpdateStateChanged = (updateState: IUpdateState) => {
    // If the update is not being downloaded (`UpdateStatus.UpdateAvailable`),
    // i.e. if it's already downloaded or not available, close the window.
    if (updateState.status !== UpdateStatus.UpdateAvailable) {
      this.props.dispatcher.quitApp(false)
    }
  }

  public componentDidMount() {
    this.updateStoreEventHandle = updateStore.onDidChange(
      this.onUpdateStateChanged
    )

    // Manually update the state to ensure we're in sync with the store
    this.onUpdateStateChanged(updateStore.state)
  }

  public componentWillUnmount() {
    if (this.updateStoreEventHandle) {
      this.updateStoreEventHandle.dispose()
      this.updateStoreEventHandle = null
    }

    // This will ensure the app doesn't try to quit after the update is
    // installed once the dialog is closed (explicitly or implicitly, by
    // opening another dialog on top of this one).
    this.props.dispatcher.cancelQuittingApp()
  }

  private onQuitAnywayButtonClicked = () => {
    this.props.dispatcher.quitApp(true)
  }

  public render() {
    return (
      <Dialog
        id="installing-update"
        title={__DARWIN__ ? 'Installing Update…' : 'Installing update…'}
        loading={true}
        onSubmit={this.props.onDismissed}
        backdropDismissable={false}
        type="warning"
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <Row className="updating-message">
            Do not close Git Desktop while the update is in progress. Closing
            now may break your installation.
          </Row>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={__DARWIN__ ? 'Quit Anyway' : 'Quit anyway'}
            onOkButtonClick={this.onQuitAnywayButtonClicked}
            onCancelButtonClick={this.props.onDismissed}
            destructive={true}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
