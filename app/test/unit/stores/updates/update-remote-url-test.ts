import assert from 'node:assert'
import { describe, it, TestContext } from 'node:test'
import {
  getDotComAPIEndpoint,
  IAPIFullRepository,
} from '../../../../src/lib/api'
import { addRemote } from '../../../../src/lib/git'
import { GitStore, RepositoriesStore } from '../../../../src/lib/stores'
import { updateRemoteUrl } from '../../../../src/lib/stores/updates/update-remote-url'
import { TestRepositoriesDatabase } from '../../../helpers/databases'
import { setupFixtureRepository } from '../../../helpers/repositories'
import { shell } from '../../../helpers/test-app-shell'
import { TestStatsStore } from '../../../helpers/test-stats-store'

describe('Update remote url', () => {
  const apiRepository: IAPIFullRepository = {
    clone_url: 'https://github.com/my-user/my-repo',
    ssh_url: 'git@github.com:my-user/my-repo.git',
    html_url: 'https://github.com/my-user/my-repo',
    name: 'my-repo',
    owner: {
      id: 42,
      html_url: 'https://github.com/my-user',
      login: 'my-user',
      avatar_url: 'https://github.com/my-user.png',
      type: 'User',
    },
    private: true,
    fork: false,
    default_branch: 'master',
    pushed_at: '1995-12-17T03:24:00',
    has_issues: true,
    archived: false,
    parent: undefined,
  }
  const endpoint = getDotComAPIEndpoint()

  let gitStore: GitStore

  const createRepository = async (
    t: TestContext,
    apiRepo: IAPIFullRepository,
    remoteUrl: string | null = null
  ) => {
    const db = new TestRepositoriesDatabase()
    await db.reset()
    const repositoriesStore = new RepositoriesStore(db)

    const repoPath = await setupFixtureRepository(t, 'test-repo')
    const repository = await repositoriesStore.setGitHubRepository(
      await repositoriesStore.addRepository(repoPath),
      await repositoriesStore.upsertGitHubRepository(endpoint, apiRepo)
    )
    await addRemote(repository, 'origin', remoteUrl || apiRepo.clone_url)
    gitStore = new GitStore(repository, shell, new TestStatsStore())
    await gitStore.loadRemotes()
    const { gitHubRepository } = repository

    return { gitHubRepository, gitStore }
  }

  it("updates the repository's remote url when the github url changes", async t => {
    const { gitHubRepository, gitStore } = await createRepository(
      t,
      apiRepository
    )
    assert(gitStore.currentRemote !== null)

    const originalUrl = gitStore.currentRemote.url
    const updatedUrl = 'https://github.com/my-user/my-updated-repo'
    const updatedApiRepository = { ...apiRepository, clone_url: updatedUrl }
    await updateRemoteUrl(gitStore, gitHubRepository, updatedApiRepository)
    assert.notEqual(originalUrl, updatedUrl)
    assert.equal(gitStore.currentRemote.url, updatedUrl)
  })

  it("doesn't update the repository's remote url when the github url is the same", async t => {
    const { gitHubRepository, gitStore } = await createRepository(
      t,
      apiRepository
    )
    assert(gitStore.currentRemote !== null)
    const originalUrl = gitStore.currentRemote.url
    assert.notEqual(originalUrl.length, 0, 'Expected originalUrl to be empty')
    await updateRemoteUrl(gitStore, gitHubRepository, apiRepository)
    assert(gitStore.currentRemote !== null)
    assert.equal(gitStore.currentRemote.url, originalUrl)
  })

  it("doesn't update repository's remote url if protocols don't match", async t => {
    const originalUrl = 'git@github.com:xixu-me/git-desktop.git'
    const sshApiRepository = {
      ...apiRepository,
      clone_url: originalUrl,
    }
    const { gitHubRepository, gitStore } = await createRepository(
      t,
      sshApiRepository
    )
    const updatedUrl = 'https://github.com/my-user/my-updated-repo'
    const updatedApiRepository = { ...apiRepository, clone_url: updatedUrl }

    await updateRemoteUrl(gitStore, gitHubRepository, updatedApiRepository)
    assert(gitStore.currentRemote !== null)
    assert.equal(gitStore.currentRemote.url, originalUrl)
  })

  it("doesn't update the repository's remote url if it differs from the default from the github API", async t => {
    const originalUrl = 'https://github.com/my-user/something-different'
    const { gitHubRepository, gitStore } = await createRepository(
      t,
      apiRepository,
      originalUrl
    )

    const updatedUrl = 'https://github.com/my-user/my-updated-repo'
    const updatedApiRepository = { ...apiRepository, clone_url: updatedUrl }

    await updateRemoteUrl(gitStore, gitHubRepository, updatedApiRepository)
    assert(gitStore.currentRemote !== null)
    assert.equal(gitStore.currentRemote.url, originalUrl)
  })
})
