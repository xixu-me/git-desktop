import assert from 'node:assert'
import { describe, it } from 'node:test'
import { findForkedRemotesToPrune } from '../../src/lib/stores/helpers/find-forked-remotes-to-prune'
import { Branch, BranchType } from '../../src/models/branch'
import { CommitIdentity } from '../../src/models/commit-identity'
import { GitHubRepository } from '../../src/models/github-repository'
import { PullRequest } from '../../src/models/pull-request'
import { IRemote } from '../../src/models/remote'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'

function createSamplePullRequest(
  gitHubRepository: GitHubRepository,
  userName: string,
  baseBranchName: string
) {
  return new PullRequest(
    new Date(),
    'desktop',
    1,
    {
      ref: 'main',
      sha: 'deadbeef',
      gitHubRepository,
    },
    {
      ref: baseBranchName,
      sha: 'deadbeef',
      gitHubRepository,
    },
    userName,
    false,
    'sample body'
  )
}

function createSampleBranch(name: string, upstream: string | null) {
  const author = new CommitIdentity(
    'someone',
    'someone@somewhere.com',
    new Date()
  )

  const branchTip = {
    sha: '300acef',
    author,
  }

  return new Branch(name, upstream, branchTip, BranchType.Local, '')
}

describe('findForkedRemotesToPrune', () => {
  const TestUserName = 'sergiou87'

  const OriginRemote = 'origin'
  const NonGitHubDesktopRemote = 'non-github-desktop-remote'
  const GitHubDesktopRemoteWithLocalBranch = 'github-desktop-niik'
  const GitHubDesktopRemoteWithPullRequest = `github-desktop-${TestUserName}`

  const remotes = [
    {
      name: OriginRemote,
      url: 'https://github.com/xixu-me/git-desktop.git',
    },
    {
      name: NonGitHubDesktopRemote,
      url: 'https://github.com/fakeuser/desktop.git',
    },
    {
      name: GitHubDesktopRemoteWithLocalBranch,
      url: 'https://github.com/niik/desktop.git',
    },
    {
      name: GitHubDesktopRemoteWithPullRequest,
      url: `https://github.com/${TestUserName}/desktop.git`,
    },
  ]

  function getNamesFromRemotes(remotes: readonly IRemote[]) {
    return remotes.map(r => r.name)
  }

  it('never prunes remotes not created by the app', () => {
    const remotesToPrune = findForkedRemotesToPrune(remotes, [], [])

    const names = getNamesFromRemotes(remotesToPrune)
    assert.notEqual(names.length, 0, 'Expected names to be empty')
    assert(!names.includes(OriginRemote))
    assert(!names.includes(NonGitHubDesktopRemote))
  })

  it('never prunes remotes with local branches', () => {
    const allBranches = [
      createSampleBranch(
        'app-store-refactor',
        `${GitHubDesktopRemoteWithLocalBranch}/app-store-refactor`
      ),
    ]

    const remotesToPrune = findForkedRemotesToPrune(remotes, [], allBranches)

    assert(
      !getNamesFromRemotes(remotesToPrune).includes(
        GitHubDesktopRemoteWithLocalBranch
      )
    )
  })

  it('never prunes remotes with pull requests', () => {
    const forkRepository = gitHubRepoFixture({
      name: 'desktop',
      owner: TestUserName,
    })
    const openPRs = [
      createSamplePullRequest(forkRepository, TestUserName, 'my-cool-feature'),
    ]

    const remotesToPrune = findForkedRemotesToPrune(remotes, openPRs, [])

    assert(
      !getNamesFromRemotes(remotesToPrune).includes(
        GitHubDesktopRemoteWithPullRequest
      )
    )
  })

  it('prunes remotes without pull requests or local branches', () => {
    const remotesToPrune = findForkedRemotesToPrune(remotes, [], [])

    const remoteNames = getNamesFromRemotes(remotesToPrune)
    assert(remoteNames.includes(GitHubDesktopRemoteWithPullRequest))
    assert(remoteNames.includes(GitHubDesktopRemoteWithLocalBranch))
  })
})
