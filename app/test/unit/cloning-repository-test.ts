import assert from 'node:assert'
import { describe, it } from 'node:test'
import { CloningRepository } from '../../src/models/cloning-repository'

describe('CloningRepository', () => {
  describe('name', () => {
    it('provides the name of the repository being cloned', () => {
      const repository = new CloningRepository(
        'C:/some/path/to/desktop',
        'https://github.com/xixu-me/git-desktop'
      )

      assert.equal(repository.name, 'desktop')
    })

    it('extracts the repo name from the url not the path', () => {
      const repository = new CloningRepository(
        'C:/some/path/to/repo',
        'https://github.com/xixu-me/git-desktop'
      )

      assert.equal(repository.name, 'desktop')
    })

    it('extracts the repo name without git suffix', () => {
      const repository = new CloningRepository(
        'C:/some/path/to/repo',
        'https://github.com/xixu-me/git-desktop.git'
      )

      assert.equal(repository.name, 'desktop')
    })
  })
})
