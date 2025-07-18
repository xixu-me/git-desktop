import {
  SupportedPlatform,
  detectPlatformFromHostname,
} from './platform-support'

export type GitProtocol = 'ssh' | 'https'

interface IGitRemoteURL {
  readonly protocol: GitProtocol

  /** The hostname of the remote. */
  readonly hostname: string

  /**
   * The owner of the repository. This will be null if the URL doesn't
   * take the form of a standard repository URL (e.g., owner/name).
   */
  readonly owner: string

  /**
   * The name of the repository. This will be null if the URL doesn't
   * take the form of a standard repository URL (e.g., owner/name).
   */
  readonly name: string

  /**
   * The detected platform for this remote URL
   */
  readonly platform: SupportedPlatform
}

// Enhanced regex patterns to support multiple platforms
// Examples:
// https://github.com/octocat/Hello-World.git
// https://gitlab.com/octocat/Hello-World.git
// https://bitbucket.org/octocat/Hello-World.git
// https://gitee.com/octocat/Hello-World.git
// https://gitcode.net/octocat/Hello-World.git
// https://huggingface.co/octocat/Hello-World.git
// git@github.com:octocat/Hello-World.git
// git@gitlab.com:octocat/Hello-World.git
// etc.
const remoteRegexes: ReadonlyArray<{ protocol: GitProtocol; regex: RegExp }> = [
  // HTTPS patterns - supports all platforms
  {
    protocol: 'https',
    regex: new RegExp(
      '^https?://(?:.+@)?(.+)/([^/]+)/([^/]+?)(?:/|\\.git/?)?$'
    ),
  },
  // Standard SSH patterns - git@hostname:owner/repo.git
  {
    protocol: 'ssh',
    regex: new RegExp('^git@(.+):([^/]+)/([^/]+?)(?:/|\\.git)?$'),
  },
  // GitHub Enterprise SSH pattern
  {
    protocol: 'ssh',
    regex: new RegExp(
      '^(?:.+)@(.+\\.ghe\\.com):([^/]+)/([^/]+?)(?:/|\\.git)?$'
    ),
  },
  // GitLab self-hosted SSH pattern
  {
    protocol: 'ssh',
    regex: new RegExp('^git@(.+\\.gitlab\\..*):([^/]+)/([^/]+?)(?:/|\\.git)?$'),
  },
  // Bitbucket self-hosted SSH pattern
  {
    protocol: 'ssh',
    regex: new RegExp(
      '^git@(.+\\.bitbucket\\..*):([^/]+)/([^/]+?)(?:/|\\.git)?$'
    ),
  },
  // Generic git protocol
  {
    protocol: 'ssh',
    regex: new RegExp('^git:(.+)/([^/]+)/([^/]+?)(?:/|\\.git)?$'),
  },
  // SSH with explicit protocol
  {
    protocol: 'ssh',
    regex: new RegExp('^ssh://git@(.+)/(.+)/(.+?)(?:/|\\.git)?$'),
  },
  // Hugging Face specific patterns (supports models, datasets, spaces)
  {
    protocol: 'https',
    regex: new RegExp(
      '^https?://(?:.+@)?huggingface\\.co/([^/]+)/([^/]+?)(?:/|\\.git/?)?$'
    ),
  },
  {
    protocol: 'ssh',
    regex: new RegExp('^git@huggingface\\.co:([^/]+)/([^/]+?)(?:/|\\.git)?$'),
  },
]

/** Parse the remote information from URL. */
export function parseRemote(url: string): IGitRemoteURL | null {
  for (const { protocol, regex } of remoteRegexes) {
    const match = regex.exec(url)
    if (match !== null && match.length >= 4) {
      const hostname = match[1]
      const owner = match[2]
      const name = match[3]
      const platform = detectPlatformFromHostname(hostname)

      return { protocol, hostname, owner, name, platform }
    }
  }

  return null
}

export interface IRepositoryIdentifier {
  readonly hostname: string | null
  readonly owner: string
  readonly name: string
}

/** Try to parse an owner and name from a URL or owner/name shortcut. */
export function parseRepositoryIdentifier(
  url: string
): IRepositoryIdentifier | null {
  const parsed = parseRemote(url)
  // If we can parse it as a remote URL, we'll assume they gave us a proper
  // URL. If not, we'll try treating it as a GitHub repository owner/name
  // shortcut.
  if (parsed) {
    const { owner, name, hostname } = parsed
    if (owner && name) {
      return { owner, name, hostname }
    }
  }

  const pieces = url.split('/')
  if (pieces.length === 2 && pieces[0].length > 0 && pieces[1].length > 0) {
    const owner = pieces[0]
    const name = pieces[1]
    return { owner, name, hostname: null }
  }

  return null
}
