import { GitError as DugiteError } from 'dugite'
import { Branch } from '../../models/branch'
import { Repository } from '../../models/repository'
import {
  IStashEntry,
  StashedChangesLoadStates,
  StashedFileChanges,
} from '../../models/stash-entry'
import {
  CommittedFileChange,
  WorkingDirectoryFileChange,
} from '../../models/status'
import { coerceToString, git, GitError } from './core'
import { createLogParser } from './git-delimiter-parser'
import { parseRawLogWithNumstat } from './log'
import { stageFiles } from './update-index'

export const DesktopStashEntryMarker = '!!GitHub_Desktop'

/**
 * RegEx for determining if a stash entry is created by Desktop
 *
 * This is done by looking for a magic string with the following
 * format: `!!GitHub_Desktop<branch>`
 */
const desktopStashEntryMessageRe = /!!GitHub_Desktop<(.+)>$/

type StashResult = {
  /** The stash entries created by Desktop */
  readonly desktopEntries: ReadonlyArray<IStashEntry>

  /**
   * The total amount of stash entries,
   * i.e. stash entries created both by Desktop and outside of Desktop
   */
  readonly stashEntryCount: number
}

/**
 * Get the list of stash entries created by Desktop in the current repository
 * using the default ordering of refs (which is LIFO ordering),
 * as well as the total amount of stash entries.
 */
export async function getStashes(repository: Repository): Promise<StashResult> {
  const { formatArgs, parse } = createLogParser({
    name: '%gD',
    stashSha: '%H',
    message: '%gs',
    tree: '%T',
    parents: '%P',
  })

  const result = await git(
    ['log', '-g', ...formatArgs, 'refs/stash', '--'],
    repository.path,
    'getStashEntries',
    { successExitCodes: new Set([0, 128]) }
  )

  // There's no refs/stashes reflog in the repository or it's not
  // even a repository. In either case we don't care
  if (result.exitCode === 128) {
    return { desktopEntries: [], stashEntryCount: 0 }
  }

  const desktopEntries: Array<IStashEntry> = []
  const files: StashedFileChanges = { kind: StashedChangesLoadStates.NotLoaded }

  const entries = parse(result.stdout)

  for (const { name, message, stashSha, tree, parents } of entries) {
    const branchName = extractBranchFromMessage(message)

    if (branchName !== null) {
      desktopEntries.push({
        name,
        stashSha,
        branchName,
        tree,
        parents: parents.length > 0 ? parents.split(' ') : [],
        files,
      })
    }
  }

  return { desktopEntries, stashEntryCount: entries.length - 1 }
}

/**
 * Moves a stash entry to a different branch by means of creating
 * a new stash entry associated with the new branch and dropping the old
 * stash entry.
 */
export async function moveStashEntry(
  repository: Repository,
  { stashSha, parents, tree }: IStashEntry,
  branchName: string
) {
  const message = `On ${branchName}: ${createDesktopStashMessage(branchName)}`
  const parentArgs = parents.flatMap(p => ['-p', p])

  const { stdout: commitId } = await git(
    ['commit-tree', ...parentArgs, '-m', message, '--no-gpg-sign', tree],
    repository.path,
    'moveStashEntryToBranch'
  )

  await git(
    ['stash', 'store', '-m', message, commitId.trim()],
    repository.path,
    'moveStashEntryToBranch'
  )

  await dropDesktopStashEntry(repository, stashSha)
}

/**
 * Returns the last Desktop created stash entry for the given branch
 */
export async function getLastDesktopStashEntryForBranch(
  repository: Repository,
  branch: Branch | string
) {
  const stash = await getStashes(repository)
  const branchName = typeof branch === 'string' ? branch : branch.name

  // Since stash objects are returned in a LIFO manner, the first
  // entry found is guaranteed to be the last entry created
  return (
    stash.desktopEntries.find(stash => stash.branchName === branchName) || null
  )
}

/** Creates a stash entry message that indicates the entry was created by Desktop */
export function createDesktopStashMessage(branchName: string) {
  return `${DesktopStashEntryMarker}<${branchName}>`
}

/**
 * Stash the working directory changes for the current branch
 */
export async function createDesktopStashEntry(
  repository: Repository,
  branch: Branch | string,
  untrackedFilesToStage: ReadonlyArray<WorkingDirectoryFileChange>
): Promise<boolean> {
  // We must ensure that no untracked files are present before stashing
  // See https://github.com/xixu-me/git-desktop/pull/8085
  // First ensure that all changes in file are selected
  // (in case the user has not explicitly checked the checkboxes for the untracked files)
  const fullySelectedUntrackedFiles = untrackedFilesToStage.map(x =>
    x.withIncludeAll(true)
  )
  await stageFiles(repository, fullySelectedUntrackedFiles)

  const branchName = typeof branch === 'string' ? branch : branch.name
  const message = createDesktopStashMessage(branchName)
  const args = ['stash', 'push', '-m', message]

  const result = await git(args, repository.path, 'createStashEntry').catch(
    e => {
      // Note: 2024: Here be dragons. As I converted this code to get rid of the
      // successExitCode use I got curious about the assumptions made in the
      // following logic. It assumes that as long as the exit code for `git
      // stash push` is 1 and there are no lines beginning with "error: " then
      // a stash was created. That didn't hold up to a quick read of the stash
      // code. For example, running git stash push in an unborn repository will
      // get you an exit code of 1 but no stash was created:
      //
      // % git stash push -m foo ; echo $?
      // You do not have the initial commit yet
      // 1
      //
      // I'm not going to mess with this now but I felt the need to document
      // my findings should I or any other brave soul choose to tackle this in
      // the future.
      if (e instanceof GitError && e.result.exitCode === 1) {
        // search for any line starting with `error:` -  /m here to ensure this is
        // applied to each line, without needing to split the text
        const errorPrefixRe = /^error: /m

        const matches = errorPrefixRe.exec(coerceToString(e.result.stderr))
        if (matches !== null && matches.length > 0) {
          // rethrow, because these messages should prevent the stash from being created
          return Promise.reject(e)
        }

        // if no error messages were emitted by Git, we should log but continue because
        // a valid stash was created and this should not interfere with the checkout

        log.info(
          `[createDesktopStashEntry] a stash was created successfully but exit code ${result.exitCode} reported. stderr: ${result.stderr}`
        )
        return e.result
      }
      return Promise.reject(e)
    }
  )

  // Stash doesn't consider it an error that there aren't any local changes to save.
  if (result.stdout === 'No local changes to save\n') {
    return false
  }

  return true
}

async function getStashEntryMatchingSha(repository: Repository, sha: string) {
  const stash = await getStashes(repository)
  return stash.desktopEntries.find(e => e.stashSha === sha) || null
}

/**
 * Removes the given stash entry if it exists
 *
 * @param stashSha the SHA that identifies the stash entry
 */
export async function dropDesktopStashEntry(
  repository: Repository,
  stashSha: string
) {
  const entryToDelete = await getStashEntryMatchingSha(repository, stashSha)

  if (entryToDelete !== null) {
    const args = ['stash', 'drop', entryToDelete.name]
    await git(args, repository.path, 'dropStashEntry')
  }
}

/**
 * Pops the stash entry identified by matching `stashSha` to its commit hash.
 *
 * To see the commit hash of stash entry, run
 * `git log -g refs/stash --pretty="%nentry: %gd%nsubject: %gs%nhash: %H%n"`
 * in a repo with some stash entries.
 */
export async function popStashEntry(
  repository: Repository,
  stashSha: string
): Promise<void> {
  // ignoring these git errors for now, this will change when we start
  // implementing the stash conflict flow
  const expectedErrors = new Set<DugiteError>([DugiteError.MergeConflicts])
  const stashToPop = await getStashEntryMatchingSha(repository, stashSha)

  if (stashToPop !== null) {
    const args = ['stash', 'pop', '--quiet', `${stashToPop.name}`]
    await git(args, repository.path, 'popStashEntry', {
      expectedErrors,
    }).catch(e => {
      // popping a stashes that create conflicts in the working directory
      // report an exit code of `1` and are not dropped after being applied.
      // so, we check for this case and drop them manually unless there's
      // anything in stderr as that could have prevented the stash from being
      // popped. Not the greatest approach but stash isn't very communicative
      if (
        e instanceof GitError &&
        e.result.exitCode === 1 &&
        e.result.stderr.length === 0
      ) {
        log.info(
          `[popStashEntry] a stash was popped successfully but exit code ${e.result.exitCode} reported.`
        )
        // bye bye
        return dropDesktopStashEntry(repository, stashSha)
      }
      return Promise.reject(e)
    })
  }
}

function extractBranchFromMessage(message: string): string | null {
  const match = desktopStashEntryMessageRe.exec(message)
  return match === null || match[1].length === 0 ? null : match[1]
}

/** Get the files that were changed in the given stash commit */
export async function getStashedFiles(
  repository: Repository,
  stashSha: string
): Promise<ReadonlyArray<CommittedFileChange>> {
  const args = [
    'stash',
    'show',
    stashSha,
    '--raw',
    '--numstat',
    '-z',
    '--format=format:',
    '--no-show-signature',
    '--',
  ]

  const { stdout } = await git(args, repository.path, 'getStashedFiles')

  return parseRawLogWithNumstat(stdout, stashSha, `${stashSha}^`).files
}
