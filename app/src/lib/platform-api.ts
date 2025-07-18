import { Account } from '../models/account'
import {
  APIError,
  getUserAgent,
  HTTPMethod,
  parsedResponse,
  request,
} from './http'
import {
  detectPlatformFromHostname,
  getPlatformConfig,
  SupportedPlatform,
} from './platform-support'

/**
 * Generic repository interface that works across all platforms
 */
export interface IGenericRepository {
  readonly id: string | number
  readonly name: string
  readonly fullName: string
  readonly description: string | null
  readonly htmlUrl: string
  readonly cloneUrl: string
  readonly sshUrl: string
  readonly defaultBranch: string
  readonly isPrivate: boolean
  readonly isFork: boolean
  readonly owner: IGenericUser
  readonly parent?: IGenericRepository
  readonly createdAt: string
  readonly updatedAt: string
  readonly pushedAt: string
  readonly hasIssues: boolean
  readonly isArchived: boolean
  readonly platform: SupportedPlatform
}

/**
 * Generic user interface that works across all platforms
 */
export interface IGenericUser {
  readonly id: string | number
  readonly login: string
  readonly name: string | null
  readonly email: string | null
  readonly avatarUrl: string
  readonly htmlUrl: string
  readonly type: 'User' | 'Organization'
  readonly platform: SupportedPlatform
}

/**
 * Generic issue interface that works across all platforms
 */
export interface IGenericIssue {
  readonly id: string | number
  readonly number: number
  readonly title: string
  readonly body: string | null
  readonly state: 'open' | 'closed'
  readonly htmlUrl: string
  readonly author: IGenericUser
  readonly assignees: ReadonlyArray<IGenericUser>
  readonly labels: ReadonlyArray<IGenericLabel>
  readonly createdAt: string
  readonly updatedAt: string
  readonly closedAt: string | null
  readonly platform: SupportedPlatform
}

/**
 * Generic pull request interface that works across all platforms
 */
export interface IGenericPullRequest {
  readonly id: string | number
  readonly number: number
  readonly title: string
  readonly body: string | null
  readonly state: 'open' | 'closed' | 'merged'
  readonly htmlUrl: string
  readonly author: IGenericUser
  readonly assignees: ReadonlyArray<IGenericUser>
  readonly reviewers: ReadonlyArray<IGenericUser>
  readonly labels: ReadonlyArray<IGenericLabel>
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly sourceRepository: IGenericRepository
  readonly targetRepository: IGenericRepository
  readonly createdAt: string
  readonly updatedAt: string
  readonly mergedAt: string | null
  readonly platform: SupportedPlatform
}

/**
 * Generic label interface that works across all platforms
 */
export interface IGenericLabel {
  readonly id: string | number
  readonly name: string
  readonly color: string
  readonly description: string | null
  readonly platform: SupportedPlatform
}

/**
 * Platform-specific API client interface
 */
export interface IPlatformAPIClient {
  readonly platform: SupportedPlatform
  readonly endpoint: string
  readonly token: string | null

  // Repository operations
  fetchRepository(owner: string, name: string): Promise<IGenericRepository>
  fetchRepositories(options?: {
    page?: number
    perPage?: number
  }): Promise<ReadonlyArray<IGenericRepository>>

  // User operations
  fetchUser(login: string): Promise<IGenericUser>
  fetchAuthenticatedUser(): Promise<IGenericUser>

  // Issue operations (if supported)
  fetchIssues(
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'all' }
  ): Promise<ReadonlyArray<IGenericIssue>>
  fetchIssue(
    owner: string,
    repo: string,
    number: number
  ): Promise<IGenericIssue>

  // Pull request operations (if supported)
  fetchPullRequests(
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'all' }
  ): Promise<ReadonlyArray<IGenericPullRequest>>
  fetchPullRequest(
    owner: string,
    repo: string,
    number: number
  ): Promise<IGenericPullRequest>

  // OAuth operations (if supported)
  getOAuthAuthorizationUrl(state: string, scopes?: string[]): string
  requestOAuthToken(code: string): Promise<string>

  // Utility methods
  isAuthenticated(): boolean
  supportsFeature(feature: string): boolean
}

/**
 * Base API client class with common functionality
 */
export abstract class BasePlatformAPIClient implements IPlatformAPIClient {
  public readonly platform: SupportedPlatform
  public readonly endpoint: string
  public readonly token: string | null

  protected abstract getAuthorizationHeader(): string

  // Abstract methods to be implemented by platform-specific clients
  public abstract fetchRepository(
    owner: string,
    name: string
  ): Promise<IGenericRepository>
  public abstract fetchRepositories(options?: {
    page?: number
    perPage?: number
  }): Promise<ReadonlyArray<IGenericRepository>>
  public abstract fetchUser(login: string): Promise<IGenericUser>
  public abstract fetchAuthenticatedUser(): Promise<IGenericUser>
  public abstract fetchIssues(
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'all' }
  ): Promise<ReadonlyArray<IGenericIssue>>
  public abstract fetchIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<IGenericIssue>
  public abstract fetchPullRequests(
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'all' }
  ): Promise<ReadonlyArray<IGenericPullRequest>>
  public abstract fetchPullRequest(
    owner: string,
    repo: string,
    pullRequestNumber: number
  ): Promise<IGenericPullRequest>
  public abstract getOAuthAuthorizationUrl(
    state: string,
    scopes?: string[]
  ): string
  public abstract requestOAuthToken(code: string): Promise<string>

  public constructor(
    platform: SupportedPlatform,
    endpoint: string,
    token: string | null = null
  ) {
    this.platform = platform
    this.endpoint = endpoint
    this.token = token
  }

  protected async makeRequest<T>(
    method: HTTPMethod,
    path: string,
    body?: any,
    options?: { headers?: Record<string, string> }
  ): Promise<T> {
    const headers: Record<string, string> = {
      'User-Agent': getUserAgent(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options?.headers,
    }

    if (this.token) {
      headers['Authorization'] = this.getAuthorizationHeader()
    }

    const url = `${this.endpoint}${path}`
    const response = await request(url, this.token, method, path, body, headers)

    if (!response.ok) {
      const errorText = await response.text()
      throw new APIError(response, { message: errorText })
    }

    return await parsedResponse<T>(response)
  }

  public isAuthenticated(): boolean {
    return this.token !== null
  }

  public supportsFeature(feature: string): boolean {
    const config = getPlatformConfig(this.platform)
    return (config as any)[`supports${feature}`] === true
  }
}

/**
 * GitHub API client implementation
 */
export class GitHubAPIClient extends BasePlatformAPIClient {
  public constructor(endpoint: string, token: string | null = null) {
    super(SupportedPlatform.GitHub, endpoint, token)
  }

  protected getAuthorizationHeader(): string {
    return `token ${this.token}`
  }

  public getOAuthAuthorizationUrl(state: string, scopes?: string[]): string {
    const config = getPlatformConfig(this.platform)
    const clientId = __OAUTH_CLIENT_ID__ || ''
    const scope = (scopes || ['repo', 'user']).join(' ')

    const params = new URLSearchParams({
      client_id: clientId,
      state,
      scope,
    })

    return `${config.oauthEndpoint}/authorize?${params}`
  }

  public async requestOAuthToken(code: string): Promise<string> {
    const clientId = __OAUTH_CLIENT_ID__ || ''
    const clientSecret = __OAUTH_SECRET__ || ''

    const response = await this.makeRequest<any>(
      'POST',
      '/login/oauth/access_token',
      {
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }
    )

    return response.access_token
  }

  public async fetchRepository(
    owner: string,
    name: string
  ): Promise<IGenericRepository> {
    const repo = await this.makeRequest<any>('GET', `/repos/${owner}/${name}`)
    return this.transformRepository(repo)
  }

  public async fetchRepositories(options?: {
    page?: number
    perPage?: number
  }): Promise<ReadonlyArray<IGenericRepository>> {
    const params = new URLSearchParams()
    if (options?.page) {
      params.set('page', options.page.toString())
    }
    if (options?.perPage) {
      params.set('per_page', options.perPage.toString())
    }

    const repos = await this.makeRequest<any[]>('GET', `/user/repos?${params}`)
    return repos.map(repo => this.transformRepository(repo))
  }

  public async fetchUser(login: string): Promise<IGenericUser> {
    const user = await this.makeRequest<any>('GET', `/users/${login}`)
    return this.transformUser(user)
  }

  public async fetchAuthenticatedUser(): Promise<IGenericUser> {
    const user = await this.makeRequest<any>('GET', '/user')
    return this.transformUser(user)
  }

  public async fetchIssues(
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'all' }
  ): Promise<ReadonlyArray<IGenericIssue>> {
    const params = new URLSearchParams()
    if (options?.state) {
      params.set('state', options.state)
    }

    const issues = await this.makeRequest<any[]>(
      'GET',
      `/repos/${owner}/${repo}/issues?${params}`
    )
    return issues.map(issue => this.transformIssue(issue))
  }

  public async fetchIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<IGenericIssue> {
    const issue = await this.makeRequest<any>(
      'GET',
      `/repos/${owner}/${repo}/issues/${issueNumber}`
    )
    return this.transformIssue(issue)
  }

  public async fetchPullRequests(
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'all' }
  ): Promise<ReadonlyArray<IGenericPullRequest>> {
    const params = new URLSearchParams()
    if (options?.state) {
      params.set('state', options.state)
    }

    const prs = await this.makeRequest<any[]>(
      'GET',
      `/repos/${owner}/${repo}/pulls?${params}`
    )
    return prs.map(pr => this.transformPullRequest(pr))
  }

  public async fetchPullRequest(
    owner: string,
    repo: string,
    pullRequestNumber: number
  ): Promise<IGenericPullRequest> {
    const pr = await this.makeRequest<any>(
      'GET',
      `/repos/${owner}/${repo}/pulls/${pullRequestNumber}`
    )
    return this.transformPullRequest(pr)
  }

  private transformRepository(repo: any): IGenericRepository {
    return {
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      htmlUrl: repo.html_url,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
      isFork: repo.fork,
      owner: this.transformUser(repo.owner),
      parent: repo.parent ? this.transformRepository(repo.parent) : undefined,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at,
      hasIssues: repo.has_issues,
      isArchived: repo.archived,
      platform: this.platform,
    }
  }

  private transformUser(user: any): IGenericUser {
    return {
      id: user.id,
      login: user.login,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      htmlUrl: user.html_url,
      type: user.type,
      platform: this.platform,
    }
  }

  private transformIssue(issue: any): IGenericIssue {
    return {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      htmlUrl: issue.html_url,
      author: this.transformUser(issue.user),
      assignees:
        issue.assignees?.map((user: any) => this.transformUser(user)) || [],
      labels:
        issue.labels?.map((label: any) => this.transformLabel(label)) || [],
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      closedAt: issue.closed_at,
      platform: this.platform,
    }
  }

  private transformPullRequest(pr: any): IGenericPullRequest {
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.merged_at ? 'merged' : pr.state,
      htmlUrl: pr.html_url,
      author: this.transformUser(pr.user),
      assignees:
        pr.assignees?.map((user: any) => this.transformUser(user)) || [],
      reviewers:
        pr.requested_reviewers?.map((user: any) => this.transformUser(user)) ||
        [],
      labels: pr.labels?.map((label: any) => this.transformLabel(label)) || [],
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      sourceRepository: this.transformRepository(pr.head.repo),
      targetRepository: this.transformRepository(pr.base.repo),
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      mergedAt: pr.merged_at,
      platform: this.platform,
    }
  }

  private transformLabel(label: any): IGenericLabel {
    return {
      id: label.id,
      name: label.name,
      color: label.color,
      description: label.description,
      platform: this.platform,
    }
  }
}

/**
 * GitLab API client implementation
 */
export class GitLabAPIClient extends BasePlatformAPIClient {
  public constructor(endpoint: string, token: string | null = null) {
    super(SupportedPlatform.GitLab, endpoint, token)
  }

  protected getAuthorizationHeader(): string {
    return `Bearer ${this.token}`
  }

  public getOAuthAuthorizationUrl(state: string, scopes?: string[]): string {
    const config = getPlatformConfig(this.platform)
    const clientId = __OAUTH_CLIENT_ID__ || ''
    const scope = (scopes || ['api']).join(' ')

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      state,
      scope,
    })

    return `${config.oauthEndpoint}/authorize?${params}`
  }

  public async requestOAuthToken(code: string): Promise<string> {
    const clientId = __OAUTH_CLIENT_ID__ || ''
    const clientSecret = __OAUTH_SECRET__ || ''

    const response = await this.makeRequest<any>('POST', '/oauth/token', {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    })

    return response.access_token
  }

  public async fetchRepository(
    owner: string,
    name: string
  ): Promise<IGenericRepository> {
    const encodedPath = encodeURIComponent(`${owner}/${name}`)
    const project = await this.makeRequest<any>(
      'GET',
      `/projects/${encodedPath}`
    )
    return this.transformRepository(project)
  }

  public async fetchRepositories(options?: {
    page?: number
    perPage?: number
  }): Promise<ReadonlyArray<IGenericRepository>> {
    const params = new URLSearchParams()
    if (options?.page) {
      params.set('page', options.page.toString())
    }
    if (options?.perPage) {
      params.set('per_page', options.perPage.toString())
    }

    const projects = await this.makeRequest<any[]>('GET', `/projects?${params}`)
    return projects.map(project => this.transformRepository(project))
  }

  public async fetchUser(login: string): Promise<IGenericUser> {
    const users = await this.makeRequest<any[]>(
      'GET',
      `/users?username=${login}`
    )
    if (users.length === 0) {
      throw new Error(`User ${login} not found`)
    }
    return this.transformUser(users[0])
  }

  public async fetchAuthenticatedUser(): Promise<IGenericUser> {
    const user = await this.makeRequest<any>('GET', '/user')
    return this.transformUser(user)
  }

  public async fetchIssues(
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'all' }
  ): Promise<ReadonlyArray<IGenericIssue>> {
    const encodedPath = encodeURIComponent(`${owner}/${repo}`)
    const params = new URLSearchParams()
    if (options?.state && options.state !== 'all') {
      params.set('state', options.state)
    }

    const issues = await this.makeRequest<any[]>(
      'GET',
      `/projects/${encodedPath}/issues?${params}`
    )
    return issues.map(issue => this.transformIssue(issue))
  }

  public async fetchIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<IGenericIssue> {
    const encodedPath = encodeURIComponent(`${owner}/${repo}`)
    const issue = await this.makeRequest<any>(
      'GET',
      `/projects/${encodedPath}/issues/${issueNumber}`
    )
    return this.transformIssue(issue)
  }

  public async fetchPullRequests(
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'all' }
  ): Promise<ReadonlyArray<IGenericPullRequest>> {
    const encodedPath = encodeURIComponent(`${owner}/${repo}`)
    const params = new URLSearchParams()
    if (options?.state && options.state !== 'all') {
      params.set('state', options.state)
    }

    const mrs = await this.makeRequest<any[]>(
      'GET',
      `/projects/${encodedPath}/merge_requests?${params}`
    )
    return mrs.map(mr => this.transformPullRequest(mr))
  }

  public async fetchPullRequest(
    owner: string,
    repo: string,
    pullRequestNumber: number
  ): Promise<IGenericPullRequest> {
    const encodedPath = encodeURIComponent(`${owner}/${repo}`)
    const mr = await this.makeRequest<any>(
      'GET',
      `/projects/${encodedPath}/merge_requests/${pullRequestNumber}`
    )
    return this.transformPullRequest(mr)
  }

  private transformRepository(project: any): IGenericRepository {
    return {
      id: project.id,
      name: project.name,
      fullName: project.path_with_namespace,
      description: project.description,
      htmlUrl: project.web_url,
      cloneUrl: project.http_url_to_repo,
      sshUrl: project.ssh_url_to_repo,
      defaultBranch: project.default_branch,
      isPrivate: project.visibility === 'private',
      isFork: project.forked_from_project !== undefined,
      owner: this.transformUser(project.owner),
      parent: project.forked_from_project
        ? this.transformRepository(project.forked_from_project)
        : undefined,
      createdAt: project.created_at,
      updatedAt: project.last_activity_at,
      pushedAt: project.last_activity_at,
      hasIssues: project.issues_enabled,
      isArchived: project.archived,
      platform: this.platform,
    }
  }

  private transformUser(user: any): IGenericUser {
    return {
      id: user.id,
      login: user.username,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      htmlUrl: user.web_url,
      type: user.username ? 'User' : 'Organization',
      platform: this.platform,
    }
  }

  private transformIssue(issue: any): IGenericIssue {
    return {
      id: issue.id,
      number: issue.iid,
      title: issue.title,
      body: issue.description,
      state: issue.state,
      htmlUrl: issue.web_url,
      author: this.transformUser(issue.author),
      assignees:
        issue.assignees?.map((user: any) => this.transformUser(user)) || [],
      labels:
        issue.labels?.map((label: string) =>
          this.transformLabel({ name: label })
        ) || [],
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      closedAt: issue.closed_at,
      platform: this.platform,
    }
  }

  private transformPullRequest(mr: any): IGenericPullRequest {
    return {
      id: mr.id,
      number: mr.iid,
      title: mr.title,
      body: mr.description,
      state: mr.state,
      htmlUrl: mr.web_url,
      author: this.transformUser(mr.author),
      assignees:
        mr.assignees?.map((user: any) => this.transformUser(user)) || [],
      reviewers:
        mr.reviewers?.map((user: any) => this.transformUser(user)) || [],
      labels:
        mr.labels?.map((label: string) =>
          this.transformLabel({ name: label })
        ) || [],
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      sourceRepository: this.transformRepository(mr.source_project),
      targetRepository: this.transformRepository(mr.target_project),
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      mergedAt: mr.merged_at,
      platform: this.platform,
    }
  }

  private transformLabel(label: any): IGenericLabel {
    return {
      id: label.id || label.name,
      name: label.name,
      color: label.color || '#000000',
      description: label.description || null,
      platform: this.platform,
    }
  }
}

/**
 * Factory function to create platform-specific API clients
 */
export function createPlatformAPIClient(
  platform: SupportedPlatform,
  endpoint: string,
  token: string | null = null
): IPlatformAPIClient {
  switch (platform) {
    case SupportedPlatform.GitHub:
      return new GitHubAPIClient(endpoint, token)
    case SupportedPlatform.GitLab:
      return new GitLabAPIClient(endpoint, token)
    // Add more platforms as needed
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

/**
 * Create API client from account
 */
export function createAPIClientFromAccount(
  account: Account
): IPlatformAPIClient {
  const platform = detectPlatformFromEndpoint(account.endpoint)
  return createPlatformAPIClient(platform, account.endpoint, account.token)
}

/**
 * Detect platform from API endpoint
 */
export function detectPlatformFromEndpoint(
  endpoint: string
): SupportedPlatform {
  try {
    const url = new URL(endpoint)
    return detectPlatformFromHostname(url.hostname)
  } catch {
    return SupportedPlatform.Generic
  }
}

/**
 * Convert platform-specific repository to generic format
 */
export function normalizeRepository(
  repo: any,
  platform: SupportedPlatform
): IGenericRepository {
  const client = createPlatformAPIClient(platform, '')
  if (client instanceof GitHubAPIClient) {
    return (client as any).transformRepository(repo)
  } else if (client instanceof GitLabAPIClient) {
    return (client as any).transformRepository(repo)
  }

  throw new Error(`Unsupported platform: ${platform}`)
}
