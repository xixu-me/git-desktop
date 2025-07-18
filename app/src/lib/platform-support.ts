import { GitProtocol } from './remote-parsing'

/**
 * Supported code hosting platforms
 */
export enum SupportedPlatform {
  GitHub = 'github',
  GitLab = 'gitlab',
  Bitbucket = 'bitbucket',
  Gitee = 'gitee',
  GitCode = 'gitcode',
  HuggingFace = 'huggingface',
  Generic = 'generic',
}

/**
 * Platform configuration interface
 */
export interface IPlatformConfig {
  readonly name: string
  readonly displayName: string
  readonly hostname: string
  readonly apiEndpoint: string
  readonly oauthEndpoint: string
  readonly supportedProtocols: ReadonlyArray<GitProtocol>
  readonly supportsOAuth: boolean
  readonly supportsPersonalAccessTokens: boolean
  readonly supportsIssues: boolean
  readonly supportsPullRequests: boolean
  readonly supportsOrganizations: boolean
  readonly apiVersion?: string
  readonly defaultBranch: string
  readonly urlPatterns: ReadonlyArray<string>
  readonly sshKeyFormats: ReadonlyArray<string>
}

/**
 * Platform configurations for supported hosting providers
 */
export const PlatformConfigs: Record<SupportedPlatform, IPlatformConfig> = {
  [SupportedPlatform.GitHub]: {
    name: 'github',
    displayName: 'GitHub',
    hostname: 'github.com',
    apiEndpoint: 'https://api.github.com',
    oauthEndpoint: 'https://github.com/login/oauth',
    supportedProtocols: ['https', 'ssh'],
    supportsOAuth: true,
    supportsPersonalAccessTokens: true,
    supportsIssues: true,
    supportsPullRequests: true,
    supportsOrganizations: true,
    defaultBranch: 'main',
    urlPatterns: [
      'https://github.com/:owner/:repo',
      'git@github.com::owner/:repo.git',
      'https://github.com/:owner/:repo.git',
    ],
    sshKeyFormats: ['ed25519', 'rsa', 'ecdsa'],
  },
  [SupportedPlatform.GitLab]: {
    name: 'gitlab',
    displayName: 'GitLab',
    hostname: 'gitlab.com',
    apiEndpoint: 'https://gitlab.com/api/v4',
    oauthEndpoint: 'https://gitlab.com/oauth',
    supportedProtocols: ['https', 'ssh'],
    supportsOAuth: true,
    supportsPersonalAccessTokens: true,
    supportsIssues: true,
    supportsPullRequests: true, // GitLab calls them Merge Requests
    supportsOrganizations: true, // GitLab calls them Groups
    apiVersion: 'v4',
    defaultBranch: 'main',
    urlPatterns: [
      'https://gitlab.com/:owner/:repo',
      'git@gitlab.com::owner/:repo.git',
      'https://gitlab.com/:owner/:repo.git',
    ],
    sshKeyFormats: ['ed25519', 'rsa', 'ecdsa'],
  },
  [SupportedPlatform.Bitbucket]: {
    name: 'bitbucket',
    displayName: 'Bitbucket',
    hostname: 'bitbucket.org',
    apiEndpoint: 'https://api.bitbucket.org/2.0',
    oauthEndpoint: 'https://bitbucket.org/site/oauth2',
    supportedProtocols: ['https', 'ssh'],
    supportsOAuth: true,
    supportsPersonalAccessTokens: true,
    supportsIssues: true,
    supportsPullRequests: true,
    supportsOrganizations: true, // Bitbucket calls them Teams
    apiVersion: '2.0',
    defaultBranch: 'main',
    urlPatterns: [
      'https://bitbucket.org/:owner/:repo',
      'git@bitbucket.org::owner/:repo.git',
      'https://bitbucket.org/:owner/:repo.git',
    ],
    sshKeyFormats: ['ed25519', 'rsa', 'ecdsa'],
  },
  [SupportedPlatform.Gitee]: {
    name: 'gitee',
    displayName: 'Gitee',
    hostname: 'gitee.com',
    apiEndpoint: 'https://gitee.com/api/v5',
    oauthEndpoint: 'https://gitee.com/oauth',
    supportedProtocols: ['https', 'ssh'],
    supportsOAuth: true,
    supportsPersonalAccessTokens: true,
    supportsIssues: true,
    supportsPullRequests: true,
    supportsOrganizations: true,
    apiVersion: 'v5',
    defaultBranch: 'master', // Gitee still uses master as default
    urlPatterns: [
      'https://gitee.com/:owner/:repo',
      'git@gitee.com::owner/:repo.git',
      'https://gitee.com/:owner/:repo.git',
    ],
    sshKeyFormats: ['ed25519', 'rsa', 'ecdsa'],
  },
  [SupportedPlatform.GitCode]: {
    name: 'gitcode',
    displayName: 'GitCode',
    hostname: 'gitcode.net',
    apiEndpoint: 'https://gitcode.net/api/v4',
    oauthEndpoint: 'https://gitcode.net/oauth',
    supportedProtocols: ['https', 'ssh'],
    supportsOAuth: true,
    supportsPersonalAccessTokens: true,
    supportsIssues: true,
    supportsPullRequests: true,
    supportsOrganizations: true,
    apiVersion: 'v4',
    defaultBranch: 'main',
    urlPatterns: [
      'https://gitcode.net/:owner/:repo',
      'git@gitcode.net::owner/:repo.git',
      'https://gitcode.net/:owner/:repo.git',
    ],
    sshKeyFormats: ['ed25519', 'rsa', 'ecdsa'],
  },
  [SupportedPlatform.HuggingFace]: {
    name: 'huggingface',
    displayName: 'Hugging Face',
    hostname: 'huggingface.co',
    apiEndpoint: 'https://huggingface.co/api',
    oauthEndpoint: 'https://huggingface.co/oauth',
    supportedProtocols: ['https', 'ssh'],
    supportsOAuth: false, // Hugging Face uses API tokens
    supportsPersonalAccessTokens: true,
    supportsIssues: false, // Hugging Face doesn't have traditional issues
    supportsPullRequests: false, // Hugging Face doesn't have traditional PRs
    supportsOrganizations: true,
    defaultBranch: 'main',
    urlPatterns: [
      'https://huggingface.co/:owner/:repo',
      'git@huggingface.co::owner/:repo.git',
      'https://huggingface.co/:owner/:repo.git',
    ],
    sshKeyFormats: ['ed25519', 'rsa'],
  },
  [SupportedPlatform.Generic]: {
    name: 'generic',
    displayName: 'Generic Git',
    hostname: '',
    apiEndpoint: '',
    oauthEndpoint: '',
    supportedProtocols: ['https', 'ssh'],
    supportsOAuth: false,
    supportsPersonalAccessTokens: false,
    supportsIssues: false,
    supportsPullRequests: false,
    supportsOrganizations: false,
    defaultBranch: 'main',
    urlPatterns: [],
    sshKeyFormats: ['ed25519', 'rsa', 'ecdsa'],
  },
}

/**
 * Detect platform from hostname
 */
export function detectPlatformFromHostname(
  hostname: string
): SupportedPlatform {
  const normalizedHostname = hostname.toLowerCase()

  // Check for exact matches first
  for (const [platform, config] of Object.entries(PlatformConfigs)) {
    if (config.hostname === normalizedHostname) {
      return platform as SupportedPlatform
    }
  }

  // Check for subdomain matches
  if (normalizedHostname.includes('github')) {
    return SupportedPlatform.GitHub
  }
  if (normalizedHostname.includes('gitlab')) {
    return SupportedPlatform.GitLab
  }
  if (normalizedHostname.includes('bitbucket')) {
    return SupportedPlatform.Bitbucket
  }
  if (normalizedHostname.includes('gitee')) {
    return SupportedPlatform.Gitee
  }
  if (normalizedHostname.includes('gitcode')) {
    return SupportedPlatform.GitCode
  }
  if (normalizedHostname.includes('huggingface')) {
    return SupportedPlatform.HuggingFace
  }

  return SupportedPlatform.Generic
}

/**
 * Get platform configuration
 */
export function getPlatformConfig(
  platform: SupportedPlatform
): IPlatformConfig {
  return PlatformConfigs[platform]
}

/**
 * Check if platform supports specific feature
 */
export function platformSupportsFeature(
  platform: SupportedPlatform,
  feature: keyof Pick<
    IPlatformConfig,
    | 'supportsOAuth'
    | 'supportsPersonalAccessTokens'
    | 'supportsIssues'
    | 'supportsPullRequests'
    | 'supportsOrganizations'
  >
): boolean {
  const config = getPlatformConfig(platform)
  return config[feature]
}

/**
 * Get all supported platforms
 */
export function getSupportedPlatforms(): SupportedPlatform[] {
  return Object.values(SupportedPlatform)
}

/**
 * Check if URL belongs to a supported platform
 */
export function isSupportedPlatformURL(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const platform = detectPlatformFromHostname(urlObj.hostname)
    return platform !== SupportedPlatform.Generic
  } catch {
    return false
  }
}

/**
 * Get platform-specific API endpoint for a given base URL
 */
export function getApiEndpointForUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const platform = detectPlatformFromHostname(urlObj.hostname)
    const config = getPlatformConfig(platform)

    if (platform === SupportedPlatform.Generic) {
      return null
    }

    // For self-hosted instances, construct API endpoint
    if (urlObj.hostname !== config.hostname) {
      switch (platform) {
        case SupportedPlatform.GitLab:
          return `${urlObj.protocol}//${urlObj.hostname}/api/v4`
        case SupportedPlatform.Bitbucket:
          return `${urlObj.protocol}//${urlObj.hostname}/rest/api/1.0`
        case SupportedPlatform.GitHub:
          return `${urlObj.protocol}//${urlObj.hostname}/api/v3`
        default:
          return null
      }
    }

    return config.apiEndpoint
  } catch {
    return null
  }
}
