import React from 'react'
import { Branch } from '../../../models/branch'
import { ComputedAction } from '../../../models/computed-action'
import { RebasePreview } from '../../../models/rebase'
import { ActionStatusIcon } from '../../lib/action-status-icon'
import { updateRebasePreview } from '../../lib/update-branch'
import {
  ChooseBranchDialog,
  IBaseChooseBranchDialogProps,
  canStartOperation,
} from './base-choose-branch-dialog'
import { truncateWithEllipsis } from '../../../lib/truncate-with-ellipsis'

interface IRebaseChooseBranchDialogState {
  readonly rebasePreview: RebasePreview | null
  readonly selectedBranch: Branch | null
}

export class RebaseChooseBranchDialog extends React.Component<
  IBaseChooseBranchDialogProps,
  IRebaseChooseBranchDialogState
> {
  public constructor(props: IBaseChooseBranchDialogProps) {
    super(props)

    this.state = {
      selectedBranch: null,
      rebasePreview: null,
    }
  }

  private start = () => {
    if (!this.canStart()) {
      return
    }

    const { selectedBranch, rebasePreview } = this.state
    const { repository, currentBranch, dispatcher } = this.props

    // Just type checking here, this shouldn't be possible
    if (
      selectedBranch === null ||
      rebasePreview === null ||
      rebasePreview.kind !== ComputedAction.Clean
    ) {
      return
    }

    dispatcher.startRebase(
      repository,
      selectedBranch,
      currentBranch,
      rebasePreview.commitsAhead
    )
  }

  private canStart = (): boolean => {
    const { currentBranch } = this.props
    const { selectedBranch, rebasePreview } = this.state
    const commitCount =
      rebasePreview?.kind === ComputedAction.Clean
        ? rebasePreview.commitsBehind.length
        : undefined
    return canStartOperation(
      selectedBranch,
      currentBranch,
      commitCount,
      rebasePreview?.kind
    )
  }

  private onSelectionChanged = (selectedBranch: Branch | null) => {
    this.setState({ selectedBranch })

    if (selectedBranch === null) {
      this.setState({ rebasePreview: null })
      return
    }

    this.updateStatus(selectedBranch)
  }

  private getSubmitButtonToolTip = () => {
    const { currentBranch } = this.props
    const { selectedBranch, rebasePreview } = this.state

    const selectedBranchIsCurrentBranch =
      selectedBranch !== null &&
      currentBranch !== null &&
      selectedBranch.name === currentBranch.name

    const currentBranchIsBehindSelectedBranch =
      rebasePreview?.kind === ComputedAction.Clean
        ? rebasePreview.commitsBehind.length > 0
        : false

    return selectedBranchIsCurrentBranch
      ? 'You are not able to rebase this branch onto itself.'
      : !currentBranchIsBehindSelectedBranch
      ? 'The current branch is already up to date with the selected branch.'
      : undefined
  }

  private getDialogTitle = () => {
    const truncatedName = truncateWithEllipsis(
      this.props.currentBranch.name,
      40
    )
    return (
      <>
        Rebase <strong>{truncatedName}</strong>
      </>
    )
  }

  private updateStatus = async (baseBranch: Branch) => {
    const { currentBranch: targetBranch, repository } = this.props
    updateRebasePreview(baseBranch, targetBranch, repository, rebasePreview => {
      this.setState({ rebasePreview })
    })
  }

  private renderStatusPreviewMessage(): JSX.Element | null {
    const { rebasePreview, selectedBranch: baseBranch } = this.state
    if (rebasePreview == null || baseBranch == null) {
      return null
    }

    const { currentBranch } = this.props

    if (rebasePreview.kind === ComputedAction.Loading) {
      return this.renderLoadingRebaseMessage()
    }
    if (rebasePreview.kind === ComputedAction.Clean) {
      return this.renderCleanRebaseMessage(
        currentBranch,
        baseBranch,
        rebasePreview.commitsAhead.length,
        rebasePreview.commitsBehind.length
      )
    }

    if (rebasePreview.kind === ComputedAction.Invalid) {
      return this.renderInvalidRebaseMessage()
    }

    return null
  }

  private renderLoadingRebaseMessage() {
    return <>Checking for ability to rebase automatically…</>
  }

  private renderInvalidRebaseMessage() {
    return <>Unable to start rebase. Check you have chosen a valid branch.</>
  }

  private renderCleanRebaseMessage(
    currentBranch: Branch,
    baseBranch: Branch,
    commitsAheadCount: number,
    commitsBehindCount: number
  ) {
    // The current branch is behind the base branch
    if (commitsBehindCount > 0 && commitsAheadCount <= 0) {
      const pluralized = commitsBehindCount === 1 ? 'commit' : 'commits'
      return (
        <>
          This will fast-forward <strong>{currentBranch.name}</strong> by
          <strong>{` ${commitsBehindCount} ${pluralized}`}</strong>
          {` to match `}
          <strong>{baseBranch.name}</strong>
        </>
      )
    }

    // The current branch is behind and ahead of the base branch
    if (commitsBehindCount > 0 && commitsAheadCount > 0) {
      const pluralized = commitsAheadCount === 1 ? 'commit' : 'commits'
      return (
        <>
          This will update <strong>{currentBranch.name}</strong>
          {` by applying its `}
          <strong>{` ${commitsAheadCount} ${pluralized}`}</strong>
          {` on top of `}
          <strong>{baseBranch.name}</strong>
        </>
      )
    }

    // The current branch is a direct child of the base branch
    // Condition: commitsBehindCount <= 0 && commitsAheadCount >= 0
    return (
      <>
        <strong>{currentBranch.name}</strong>
        {` `}
        is already up to date with <strong>{baseBranch.name}</strong>
      </>
    )
  }

  private renderStatusPreview() {
    return (
      <>
        <ActionStatusIcon
          status={this.state.rebasePreview}
          classNamePrefix="merge-status"
        />
        <p className="merge-info" id="merge-status-preview">
          {this.renderStatusPreviewMessage()}
        </p>
      </>
    )
  }

  public render() {
    return (
      <ChooseBranchDialog
        {...this.props}
        start={this.start}
        selectedBranch={this.state.selectedBranch}
        canStartOperation={this.canStart()}
        dialogTitle={this.getDialogTitle()}
        submitButtonTooltip={this.getSubmitButtonToolTip()}
        onSelectionChanged={this.onSelectionChanged}
      >
        {this.renderStatusPreview()}
      </ChooseBranchDialog>
    )
  }
}
