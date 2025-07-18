import * as URL from 'url'
import { Account } from '../models/account'

import { BypassReasonType } from '../ui/secret-scanning/bypass-push-protection-dialog'
import { CopilotError } from './copilot-error'
import {
  getEndpointVersion,
  isDotCom,
  isGHE,
  isGHES,
  updateEndpointVersion,
} from './endpoint-capabilities'
import {
  APIError,
  getUserAgent,
  HTTPMethod,
  parsedResponse,
  request,
  urlWithQueryString,
} from './http'
import { HttpStatusCode } from './http-status-code'
import { GitProtocol } from './remote-parsing'
import {
  clearCertificateErrorSuppressionFor,
  suppressCertificateErrorFor,
} from './suppress-certificate-error'
import { uuid } from './uuid'

const envEndpoint = process.env['DESKTOP_GITHUB_DOTCOM_API_ENDPOINT']
const envHTMLURL = process.env['DESKTOP_GITHUB_DOTCOM_HTML_URL']
const envAdditionalCookies =
  process.env['DESKTOP_GITHUB_DOTCOM_ADDITIONAL_COOKIES']

if (envAdditionalCookies !== undefined) {
  document.cookie += '; ' + envAdditionalCookies
}

type AffiliationFilter =
  | 'owner'
  | 'collaborator'
  | 'organization_member'
  | 'owner,collabor'
  | 'owner,organization_member'
  | 'collaborator,organization_member'
  | 'owner,collaborator,organization_member'

/** Response type of GraphQL query of Copilot-related info */
type ViewerCopilotResponse = {
  readonly data: {
    readonly viewer: {
      readonly copilotEndpoints: {
        readonly api: string
      }
      readonly isCopilotDesktopEnabled: boolean
    }
  }
}

/** Copilot-related info relevant to Desktop */
type UserCopilotInfo = {
  readonly isCopilotDesktopEnabled: boolean
  readonly copilotEndpoint: string
}

/** Response type Copilot chat completions response API */
type CopilotChatCompletionResponse = {
  readonly choices: ReadonlyArray<{
    readonly index: number
    readonly message: {
      readonly content: string
    }
  }>
}

/**
 * Optional set of configurable settings for the fetchAll method
 */
interface IFetchAllOptions<T> {
  /**
   * The number of results to ask for on each page when making
   * requests to paged API endpoints.
   */
  perPage?: number

  /**
   * An optional predicate which determines whether or not to
   * continue loading results from the API. This can be used
   * to put a limit on the number of results to return from
   * a paged API resource.
   *
   * As an example, to stop loading results after 500 results:
   *
   * `(results) => results.length < 500`
   *
   * @param results  All results retrieved thus far
   */
  continue?: (results: ReadonlyArray<T>) => boolean | Promise<boolean>

  /**
   * An optional callback which is invoked after each page of results is loaded
   * from the API. This can be used to enable streaming of results.
   *
   * @param page The last fetched page of results
   */
  onPage?: (page: ReadonlyArray<T>) => void

  /**
   * Calculate the next page path given the response.
   *
   * Optional, see `getNextPagePathFromLink` for the default
   * implementation.
   */
  getNextPagePath?: (response: Response) => string | null

  /**
   * Whether or not to silently suppress request errors and
   * return the results retrieved thus far. If this field is
   * `true` the fetchAll method will suppress errors (this is
   * also the default behavior if no value is provided for
   * this field). Setting this field to false will cause the
   * fetchAll method to throw if it encounters an API error
   * on any page.
   */
  suppressErrors?: boolean
}

const ClientID = process.env.TEST_ENV ? '' : __OAUTH_CLIENT_ID__
const ClientSecret = process.env.TEST_ENV ? '' : __OAUTH_SECRET__

if (!ClientID || !ClientID.length || !ClientSecret || !ClientSecret.length) {
  log.warn(
    `DESKTOP_OAUTH_CLIENT_ID and/or DESKTOP_OAUTH_CLIENT_SECRET is undefined. You won't be able to authenticate new users.`
  )
}

export type GitHubAccountType = 'User' | 'Organization'

/** The OAuth scopes we want to request */
const oauthScopes = ['repo', 'user', 'workflow']

/**
 * Information about a repository as returned by the GitHub API.
 */
export interface IAPIRepository {
  readonly clone_url: string
  readonly ssh_url: string
  readonly html_url: string
  readonly name: string
  readonly owner: IAPIIdentity
  readonly private: boolean
  readonly fork: boolean
  readonly default_branch: string
  readonly pushed_at: string
  readonly has_issues: boolean
  readonly archived: boolean
}

/** Information needed to clone a repository. */
export interface IAPIRepositoryCloneInfo {
  /** Canonical clone URL of the repository. */
  readonly url: string

  /**
   * Default branch of the repository, if any. This is usually either retrieved
   * from the API for GitHub repositories, or undefined for other repositories.
   */
  readonly defaultBranch?: string
}

export interface IAPIFullRepository extends IAPIRepository {
  /**
   * The parent repository of a fork.
   *
   * HACK: BEWARE: This is defined as `parent: IAPIRepository | undefined`
   * rather than `parent?: ...` even though the parent property is actually
   * optional in the API response. So we're lying a bit to the type system
   * here saying that this will be present but the only time the difference
   * between omission and explicit undefined matters is when using constructs
   * like `x in y` or `y.hasOwnProperty('x')` which we do very rarely.
   *
   * Without at least one non-optional type in this interface TypeScript will
   * happily let us pass an IAPIRepository in place of an IAPIFullRepository.
   */
  readonly parent: IAPIRepository | undefined

  /**
   * The high-level permissions that the currently authenticated
   * user enjoys for the repository. Undefined if the API call
   * was made without an authenticated user or if the repository
   * isn't the primarily requested one (i.e. if this is the parent
   * repository of the requested repository)
   *
   * The permissions hash will also be omitted when the repository
   * information is embedded within another object such as a pull
   * request (base.repo or head.repo).
   *
   * In other words, the only time when the permissions property
   * will be present is when explicitly fetching the repository
   * through the `/repos/user/name` endpoint or similar.
   */
  readonly permissions?: IAPIRepositoryPermissions
}

/*
 * Information about how the user is permitted to interact with a repository.
 */
export interface IAPIRepositoryPermissions {
  readonly admin: boolean
  /* aka 'write' */
  readonly push: boolean
  /* aka 'read' */
  readonly pull: boolean
}

/**
 * Information about a commit as returned by the GitHub API.
 */
export interface IAPICommit {
  readonly sha: string
  readonly author: IAPIIdentity | {} | null
}

/**
 * Entity returned by the `/user/orgs` endpoint.
 *
 * Because this is specific to one endpoint it omits the `type` member from
 * `IAPIIdentity` that callers might expect.
 */
export interface IAPIOrganization {
  readonly id: number
  readonly url: string
  readonly login: string
  readonly avatar_url: string
}

/**
 * Minimum subset of an identity returned by the GitHub API
 */
export interface IAPIIdentity {
  readonly id: number
  readonly login: string
  readonly avatar_url: string
  readonly html_url: string
  readonly type: GitHubAccountType
}

/**
 * Complete identity details returned in some situations by the GitHub API.
 *
 * If you are not sure what is returned as part of an API response, you should
 * use `IAPIIdentity` as that contains the known subset of an identity and does
 * not cover scenarios where privacy settings of a user control what information
 * is returned.
 */
interface IAPIFullIdentity {
  readonly id: number
  readonly html_url: string
  readonly login: string
  readonly avatar_url: string

  /**
   * The user's real name or null if the user hasn't provided
   * a real name for their public profile.
   */
  readonly name: string | null

  /**
   * The email address for this user or null if the user has not
   * specified a public email address in their profile.
   */
  readonly email: string | null
  readonly type: GitHubAccountType
  readonly plan?: {
    readonly name: string
  }
}

/** The users we get from the mentionables endpoint. */
export interface IAPIMentionableUser {
  /**
   * A url to an avatar image chosen by the user
   */
  readonly avatar_url: string

  /**
   * The user's attributable email address or null if the
   * user doesn't have an email address that they can be
   * attributed by
   */
  readonly email: string | null

  /**
   * The username or "handle" of the user
   */
  readonly login: string

  /**
   * The user's real name (or at least the name that the user
   * has configured to be shown) or null if the user hasn't provided
   * a real name for their public profile.
   */
  readonly name: string | null
}

/** Represents the commit details (title and description) generated by Copilot */
interface ICopilotCommitMessage {
  readonly title: string
  readonly description: string
}

/** The response we get from the desktop_internal/features endpoint. */
interface IUserFeaturesResponse {
  readonly features: ReadonlyArray<string>
}

/**
 * Error thrown by `fetchUpdatedPullRequests` when receiving more results than
 * what the `maxResults` parameter allows for.
 */
export class MaxResultsError extends Error {}

/**
 * `null` can be returned by the API for legacy reasons. A non-null value is
 * set for the primary email address currently, but in the future visibility
 * may be defined for each email address.
 */
export type EmailVisibility = 'public' | 'private' | null

/**
 * Information about a user's email as returned by the GitHub API.
 */
export interface IAPIEmail {
  readonly email: string
  readonly verified: boolean
  readonly primary: boolean
  readonly visibility: EmailVisibility
}

/** Information about an issue as returned by the GitHub API. */
export interface IAPIIssue {
  readonly number: number
  readonly title: string
  readonly state: 'open' | 'closed'
  readonly updated_at: string
}

/** The combined state of a ref. */
export type APIRefState = 'failure' | 'pending' | 'success' | 'error'

/** The overall status of a check run */
export enum APICheckStatus {
  Queued = 'queued',
  InProgress = 'in_progress',
  Completed = 'completed',
}

/** The conclusion of a completed check run */
export enum APICheckConclusion {
  ActionRequired = 'action_required',
  Canceled = 'cancelled',
  TimedOut = 'timed_out',
  Failure = 'failure',
  Neutral = 'neutral',
  Success = 'success',
  Skipped = 'skipped',
  Stale = 'stale',
}

/**
 * The API response for a combined view of a commit
 * status for a given ref
 */
export interface IAPIRefStatusItem {
  readonly state: APIRefState
  readonly target_url: string | null
  readonly description: string
  readonly context: string
  readonly id: number
}

/** The API response to a ref status request. */
export interface IAPIRefStatus {
  readonly state: APIRefState
  readonly total_count: number
  readonly statuses: ReadonlyArray<IAPIRefStatusItem>
}

export interface IAPIRefCheckRun {
  readonly id: number
  readonly url: string
  readonly status: APICheckStatus
  readonly conclusion: APICheckConclusion | null
  readonly name: string
  readonly check_suite: IAPIRefCheckRunCheckSuite
  readonly app: IAPIRefCheckRunApp
  readonly completed_at: string
  readonly started_at: string
  readonly html_url: string
  readonly pull_requests: ReadonlyArray<IAPIPullRequest>
}

// NB. Only partially mapped
export interface IAPIRefCheckRunApp {
  readonly name: string
}

// NB. Only partially mapped
export interface IAPIRefCheckRunOutput {
  readonly title: string | null
  readonly summary: string | null
  readonly text: string | null
}

export interface IAPIRefCheckRunCheckSuite {
  readonly id: number
}

export interface IAPICheckSuite {
  readonly id: number
  readonly rerequestable: boolean
  readonly runs_rerequestable: boolean
  readonly status: APICheckStatus
  readonly created_at: string
}

export interface IAPIRefCheckRuns {
  readonly total_count: number
  readonly check_runs: IAPIRefCheckRun[]
}

interface IAPIWorkflowRuns {
  readonly total_count: number
  readonly workflow_runs: ReadonlyArray<IAPIWorkflowRun>
}
// NB. Only partially mapped
export interface IAPIWorkflowRun {
  readonly id: number
  /**
   * The workflow_id is the id of the workflow not the individual run.
   **/
  readonly workflow_id: number
  readonly cancel_url: string
  readonly created_at: string
  readonly logs_url: string
  readonly name: string
  readonly rerun_url: string
  readonly check_suite_id: number
  readonly event: string
}

export interface IAPIWorkflowJobs {
  readonly total_count: number
  readonly jobs: IAPIWorkflowJob[]
}

// NB. Only partially mapped
export interface IAPIWorkflowJob {
  readonly id: number
  readonly name: string
  readonly status: APICheckStatus
  readonly conclusion: APICheckConclusion | null
  readonly completed_at: string
  readonly started_at: string
  readonly steps: ReadonlyArray<IAPIWorkflowJobStep>
  readonly html_url: string
}

export interface IAPIWorkflowJobStep {
  readonly name: string
  readonly number: number
  readonly status: APICheckStatus
  readonly conclusion: APICheckConclusion | null
  readonly completed_at: string
  readonly started_at: string
  readonly log: string
}

/** Protected branch information returned by the GitHub API */
export interface IAPIPushControl {
  /**
   * What status checks are required before merging?
   *
   * Empty array if user is admin and branch is not admin-enforced
   */
  required_status_checks: Array<string>

  /**
   * How many reviews are required before merging?
   *
   * 0 if user is admin and branch is not admin-enforced
   */
  required_approving_review_count: number

  /**
   * Is user permitted?
   *
   * Always `true` for admins.
   * `true` if `Restrict who can push` is not enabled.
   * `true` if `Restrict who can push` is enabled and user is in list.
   * `false` if `Restrict who can push` is enabled and user is not in list.
   */
  allow_actor: boolean

  /**
   * Currently unused properties
   */
  pattern: string | null
  required_signatures: boolean
  required_linear_history: boolean
  allow_deletions: boolean
  allow_force_pushes: boolean
}

/** Branch information returned by the GitHub API */
export interface IAPIBranch {
  /**
   * The name of the branch stored on the remote.
   *
   * NOTE: this is NOT a fully-qualified ref (i.e. `refs/heads/main`)
   */
  readonly name: string
  /**
   * Branch protection settings:
   *
   *  - `true` indicates that the branch is protected in some way
   *  - `false` indicates no branch protection set
   */
  readonly protected: boolean
}

/** Repository rule information returned by the GitHub API */
export interface IAPIRepoRule {
  /**
   * The ID of the ruleset this rule is configured in.
   */
  readonly ruleset_id: number

  /**
   * The type of the rule.
   */
  readonly type: APIRepoRuleType

  /**
   * The parameters that apply to the rule if it is a metadata rule.
   * Other rule types may have parameters, but they are not used in
   * this app so they are ignored. Do not attempt to use this field
   * unless you know `type` matches a metadata rule type.
   */
  readonly parameters?: IAPIRepoRuleMetadataParameters
}

/**
 * A non-exhaustive list of rules that can be configured. Only the rule
 * types used by this app are included.
 */
export enum APIRepoRuleType {
  Creation = 'creation',
  Update = 'update',
  RequiredDeployments = 'required_deployments',
  RequiredSignatures = 'required_signatures',
  RequiredStatusChecks = 'required_status_checks',
  PullRequest = 'pull_request',
  CommitMessagePattern = 'commit_message_pattern',
  CommitAuthorEmailPattern = 'commit_author_email_pattern',
  CommitterEmailPattern = 'committer_email_pattern',
  BranchNamePattern = 'branch_name_pattern',
}

/**
 * A ruleset returned from the GitHub API's "get all rulesets for a repo" endpoint.
 * This endpoint returns a slimmed-down version of the full ruleset object, though
 * only the ID is used.
 */
export interface IAPISlimRepoRuleset {
  readonly id: number
}

/**
 * A ruleset returned from the GitHub API's "get a ruleset for a repo" endpoint.
 */
export interface IAPIRepoRuleset extends IAPISlimRepoRuleset {
  /**
   * Whether the user making the API request can bypass the ruleset.
   */
  readonly current_user_can_bypass: 'always' | 'pull_requests_only' | 'never'
}

/**
 * Metadata parameters for a repo rule metadata rule.
 */
export interface IAPIRepoRuleMetadataParameters {
  /**
   * User-supplied name/description of the rule
   */
  name: string

  /**
   * Whether the operator is negated. For example, if `true`
   * and `operator` is `starts_with`, then the rule
   * will be negated to 'does not start with'.
   */
  negate: boolean

  /**
   * The pattern to match against. If the operator is 'regex', then
   * this is a regex string match. Otherwise, it is a raw string match
   * of the type specified by `operator` with no additional parsing.
   */
  pattern: string

  /**
   * The type of match to use for the pattern. For example, `starts_with`
   * means `pattern` must be at the start of the string.
   */
  operator: APIRepoRuleMetadataOperator
}

export enum APIRepoRuleMetadataOperator {
  StartsWith = 'starts_with',
  EndsWith = 'ends_with',
  Contains = 'contains',
  RegexMatch = 'regex',
}

interface IAPIPullRequestRef {
  readonly ref: string
  readonly sha: string

  /**
   * The repository in which this ref lives. It could be null if the repository
   * has been deleted since the PR was opened.
   */
  readonly repo: IAPIRepository | null
}

/** Information about a pull request as returned by the GitHub API. */
export interface IAPIPullRequest {
  readonly number: number
  readonly title: string
  readonly created_at: string
  readonly updated_at: string
  readonly user: IAPIIdentity
  readonly head: IAPIPullRequestRef
  readonly base: IAPIPullRequestRef
  readonly body: string
  readonly state: 'open' | 'closed'
  readonly draft?: boolean
}

/** Information about a pull request review as returned by the GitHub API. */
export interface IAPIPullRequestReview {
  readonly id: number
  readonly user: IAPIIdentity
  readonly body: string
  readonly html_url: string
  readonly submitted_at: string
  readonly state:
    | 'APPROVED'
    | 'DISMISSED'
    | 'PENDING'
    | 'COMMENTED'
    | 'CHANGES_REQUESTED'
}

/** Represents both issue comments and PR review comments */
export interface IAPIComment {
  readonly id: number
  readonly body: string
  readonly html_url: string
  readonly user: IAPIIdentity
  readonly created_at: string
}

/** The server response when handling the OAuth callback (with code) to obtain an access token */
interface IAPIAccessToken {
  readonly access_token: string
  readonly scope: string
  readonly token_type: string
}

/** The response we receive from fetching mentionables. */
interface IAPIMentionablesResponse {
  readonly etag: string | undefined
  readonly users: ReadonlyArray<IAPIMentionableUser>
}

/**
 * Parses the Link header from GitHub and returns the 'next' path
 * if one is present.
 *
 * If no link rel next header is found this method returns null.
 */
function getNextPagePathFromLink(response: Response): string | null {
  const linkHeader = response.headers.get('Link')

  if (!linkHeader) {
    return null
  }

  for (const part of linkHeader.split(',')) {
    // https://github.com/philschatz/octokat.js/blob/5658abe442e8bf405cfda1c72629526a37554613/src/plugins/pagination.js#L17
    const match = part.match(/<([^>]+)>; rel="([^"]+)"/)

    if (match && match[2] === 'next') {
      const nextURL = URL.parse(match[1])
      return nextURL.path || null
    }
  }

  return null
}

/**
 * Parses the 'next' Link header from GitHub using
 * `getNextPagePathFromLink`. Unlike `getNextPagePathFromLink`
 * this method will attempt to double the page size when
 * the current page index and the page size allows for it
 * leading to a ramp up in page size.
 *
 * This might sound confusing, and it is, but the primary use
 * case for this is when retrieving updated PRs. By specifying
 * an initial page size of, for example, 10 this method will
 * increase the page size to 20 once the second page has been
 * loaded. See the table below for an example. The ramp-up
 * will stop at a page size of 100 since that's the maximum
 * that the GitHub API supports.
 *
 * ```
 * |-----------|------|-----------|-----------------|
 * | Request # | Page | Page size | Retrieved items |
 * |-----------|------|-----------|-----------------|
 * | 1         | 1    | 10        | 10              |
 * | 2         | 2    | 10        | 20              |
 * | 3         | 2    | 20        | 40              |
 * | 4         | 2    | 40        | 80              |
 * | 5         | 2    | 80        | 160             |
 * | 6         | 3    | 80        | 240             |
 * | 7         | 4    | 80        | 320             |
 * | 8         | 5    | 80        | 400             |
 * | 9         | 5    | 100       | 500             |
 * |-----------|------|-----------|-----------------|
 * ```
 * This algorithm means we can have the best of both worlds.
 * If there's a small number of changed pull requests since
 * our last update we'll do small requests that use minimal
 * bandwidth but if we encounter a repository where a lot
 * of PRs have changed since our last fetch (like a very
 * active repository or one we haven't fetched in a long time)
 * we'll spool up our page size in just a few requests and load
 * in bulk.
 *
 * As an example I used a very active internal repository and
 * asked for all PRs updated in the last 24 hours which was 320.
 * With the previous regime of fetching with a page size of 10
 * that obviously took 32 requests. With this new regime it
 * would take 7.
 */
export function getNextPagePathWithIncreasingPageSize(response: Response) {
  const nextPath = getNextPagePathFromLink(response)

  if (!nextPath) {
    return null
  }

  const { pathname, query } = URL.parse(nextPath, true)
  const { per_page, page } = query

  const pageSize = typeof per_page === 'string' ? parseInt(per_page, 10) : NaN
  const pageNumber = typeof page === 'string' ? parseInt(page, 10) : NaN

  if (!pageSize || !pageNumber) {
    return nextPath
  }

  // Confusing, but we're looking at the _next_ page path here
  // so the current is whatever came before it.
  const currentPage = pageNumber - 1

  // Number of received items thus far
  const received = currentPage * pageSize

  // Can't go above 100, that's the max the API will allow.
  const nextPageSize = Math.min(100, pageSize * 2)

  // Have we received exactly the amount of items
  // such that doubling the page size and loading the
  // second page would seamlessly fit? No sense going
  // above 100 since that's the max the API supports
  if (pageSize !== nextPageSize && received % nextPageSize === 0) {
    query.per_page = `${nextPageSize}`
    query.page = `${received / nextPageSize + 1}`
    return URL.format({ pathname, query })
  }

  return nextPath
}

/**
 * Returns an ISO 8601 time string with second resolution instead of
 * the standard javascript toISOString which returns millisecond
 * resolution. The GitHub API doesn't return dates with milliseconds
 * so we won't send any back either.
 */
function toGitHubIsoDateString(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

interface IAPIAliveSignedChannel {
  readonly channel_name: string
  readonly signed_channel: string
}

interface IAPIAliveWebSocket {
  readonly url: string
}

type TokenInvalidatedCallback = (endpoint: string, token: string) => void

export interface IAPICreatePushProtectionBypassResponse {
  reason: BypassReasonType
  expire_at: string
  token_type: string
}

/**
 * An object for making authenticated requests to the GitHub API
 */
export class API {
  private static readonly tokenInvalidatedListeners =
    new Set<TokenInvalidatedCallback>()

  public static onTokenInvalidated(callback: TokenInvalidatedCallback) {
    this.tokenInvalidatedListeners.add(callback)
  }

  private static emitTokenInvalidated(endpoint: string, token: string) {
    this.tokenInvalidatedListeners.forEach(callback =>
      callback(endpoint, token)
    )
  }

  /** Create a new API client from the given account. */
  public static fromAccount(account: Account): API {
    return new API(account.endpoint, account.token, account.copilotEndpoint)
  }

  private endpoint: string
  private token: string
  private copilotEndpoint?: string

  /** Create a new API client for the endpoint, authenticated with the token. */
  public constructor(
    endpoint: string,
    token: string,
    copilotEndpoint?: string
  ) {
    this.endpoint = endpoint
    this.token = token
    this.copilotEndpoint = copilotEndpoint
  }

  /**
   * Retrieves the name of the Alive channel used by Desktop to receive
   * high-signal notifications.
   */
  public async getAliveDesktopChannel(): Promise<IAPIAliveSignedChannel | null> {
    try {
      const res = await this.ghRequest('GET', '/desktop_internal/alive-channel')
      const signedChannel = await parsedResponse<IAPIAliveSignedChannel>(res)
      return signedChannel
    } catch (e) {
      log.warn(`Alive channel request failed: ${e}`)
      return null
    }
  }

  /**
   * Retrieves the URL for the Alive websocket.
   *
   * @returns The websocket URL if the request succeeded, null if the request
   * failed with 404, otherwise it will throw an error.
   *
   * This behavior is expected by the AliveSession class constructor, to prevent
   * it from hitting the endpoint many times if it's disabled.
   */
  public async getAliveWebSocketURL(): Promise<string | null> {
    try {
      const res = await this.ghRequest('GET', '/alive_internal/websocket-url')
      if (res.status === HttpStatusCode.NotFound) {
        return null
      }
      const websocket = await parsedResponse<IAPIAliveWebSocket>(res)
      return websocket.url
    } catch (e) {
      log.warn(`Alive web socket request failed: ${e}`)
      throw e
    }
  }

  /**
   * Fetch an issue comment (i.e. a comment on an issue or pull request).
   *
   * @param owner The owner of the repository
   * @param name The name of the repository
   * @param commentId The ID of the comment
   *
   * @returns The comment if it was found, null if it wasn't, or an error
   * occurred.
   */
  public async fetchIssueComment(
    owner: string,
    name: string,
    commentId: string
  ): Promise<IAPIComment | null> {
    try {
      const response = await this.ghRequest(
        'GET',
        `repos/${owner}/${name}/issues/comments/${commentId}`
      )
      if (response.status === HttpStatusCode.NotFound) {
        log.warn(
          `fetchIssueComment: '${owner}/${name}/issues/comments/${commentId}' returned a 404`
        )
        return null
      }
      return await parsedResponse<IAPIComment>(response)
    } catch (e) {
      log.warn(
        `fetchIssueComment: an error occurred for '${owner}/${name}/issues/comments/${commentId}'`,
        e
      )
      return null
    }
  }

  /**
   * Fetch a pull request review comment (i.e. a comment that was posted as part
   * of a review of a pull request).
   *
   * @param owner The owner of the repository
   * @param name The name of the repository
   * @param commentId The ID of the comment
   *
   * @returns The comment if it was found, null if it wasn't, or an error
   * occurred.
   */
  public async fetchPullRequestReviewComment(
    owner: string,
    name: string,
    commentId: string
  ): Promise<IAPIComment | null> {
    try {
      const response = await this.ghRequest(
        'GET',
        `repos/${owner}/${name}/pulls/comments/${commentId}`
      )
      if (response.status === HttpStatusCode.NotFound) {
        log.warn(
          `fetchPullRequestReviewComment: '${owner}/${name}/pulls/comments/${commentId}' returned a 404`
        )
        return null
      }
      return await parsedResponse<IAPIComment>(response)
    } catch (e) {
      log.warn(
        `fetchPullRequestReviewComment: an error occurred for '${owner}/${name}/pulls/comments/${commentId}'`,
        e
      )
      return null
    }
  }

  /** Fetch a repo by its owner and name. */
  public async fetchRepository(
    owner: string,
    name: string
  ): Promise<IAPIFullRepository | null> {
    try {
      const response = await this.ghRequest('GET', `repos/${owner}/${name}`)
      if (response.status === HttpStatusCode.NotFound) {
        log.warn(`fetchRepository: '${owner}/${name}' returned a 404`)
        return null
      }
      return await parsedResponse<IAPIFullRepository>(response)
    } catch (e) {
      log.warn(`fetchRepository: an error occurred for '${owner}/${name}'`, e)
      return null
    }
  }

  /**
   * Fetch info needed to clone a repository. That includes:
   *  - The canonical clone URL for a repository, respecting the protocol
   *    preference if provided.
   *  - The default branch of the repository, in case the repository is empty.
   *    Only available for GitHub repositories.
   *
   * Returns null if the request returned a 404 (NotFound). NotFound doesn't
   * necessarily mean that the repository doesn't exist, it could exist and
   * the current user just doesn't have the permissions to see it. GitHub.com
   * doesn't differentiate between not found and permission denied for private
   * repositories as that would leak the existence of a private repository.
   *
   * Note that unlike `fetchRepository` this method will throw for all errors
   * except 404 NotFound responses.
   *
   * @param owner    The repository owner (nodejs in https://github.com/nodejs/node)
   * @param name     The repository name (node in https://github.com/nodejs/node)
   * @param protocol The preferred Git protocol (https or ssh)
   */
  public async fetchRepositoryCloneInfo(
    owner: string,
    name: string,
    protocol: GitProtocol | undefined
  ): Promise<IAPIRepositoryCloneInfo | null> {
    const response = await this.ghRequest('GET', `repos/${owner}/${name}`, {
      // Make sure we don't run into cache issues when fetching the repositories,
      // specially after repositories have been renamed.
      reloadCache: true,
    })

    if (response.status === HttpStatusCode.NotFound) {
      return null
    }

    const repo = await parsedResponse<IAPIRepository>(response)
    return {
      url: protocol === 'ssh' ? repo.ssh_url : repo.clone_url,
      defaultBranch: repo.default_branch,
    }
  }

  /**
   * Fetch all repos a user has access to in a streaming fashion. The callback
   * will be called for each new page fetched from the API.
   */
  public async streamUserRepositories(
    callback: (repos: ReadonlyArray<IAPIRepository>) => void,
    affiliation?: AffiliationFilter,
    options?: IFetchAllOptions<IAPIRepository>
  ) {
    try {
      const base = 'user/repos'
      const path = affiliation ? `${base}?affiliation=${affiliation}` : base

      await this.fetchAll<IAPIRepository>(path, {
        ...options,
        // "But wait, repositories can't have a null owner" you say.
        // Ordinarily you'd be correct but turns out there's super
        // rare circumstances where a user has been deleted but the
        // repository hasn't. Such cases are usually addressed swiftly
        // but in some cases like GitHub Enterprise instances
        // they can linger for longer than we'd like so we'll make
        // sure to exclude any such dangling repository, chances are
        // they won't be cloneable anyway.
        onPage: page => {
          callback(page.filter(x => x.owner !== null))
          options?.onPage?.(page)
        },
      })
    } catch (error) {
      log.warn(
        `streamUserRepositories: failed with endpoint ${this.endpoint}`,
        error
      )
    }
  }

  /** Fetch the logged in account. */
  public async fetchAccount(): Promise<IAPIFullIdentity> {
    try {
      const response = await this.ghRequest('GET', 'user')
      const result = await parsedResponse<IAPIFullIdentity>(response)
      return result
    } catch (e) {
      log.warn(`fetchAccount: failed with endpoint ${this.endpoint}`, e)
      throw e
    }
  }

  /** Fetch the current user's emails. */
  public async fetchEmails(): Promise<ReadonlyArray<IAPIEmail>> {
    try {
      const response = await this.ghRequest('GET', 'user/emails')
      const result = await parsedResponse<ReadonlyArray<IAPIEmail>>(response)

      return Array.isArray(result) ? result : []
    } catch (e) {
      log.warn(`fetchEmails: failed with endpoint ${this.endpoint}`, e)
      return []
    }
  }

  /** Fetch all the orgs to which the user belongs. */
  public async fetchOrgs(): Promise<ReadonlyArray<IAPIOrganization>> {
    try {
      return await this.fetchAll<IAPIOrganization>('user/orgs')
    } catch (e) {
      log.warn(`fetchOrgs: failed with endpoint ${this.endpoint}`, e)
      return []
    }
  }

  /** Create a new GitHub repository with the given properties. */
  public async createRepository(
    org: IAPIOrganization | null,
    name: string,
    description: string,
    private_: boolean
  ): Promise<IAPIFullRepository> {
    try {
      const apiPath = org ? `orgs/${org.login}/repos` : 'user/repos'
      const response = await this.ghRequest('POST', apiPath, {
        body: {
          name,
          description,
          private: private_,
        },
      })

      return await parsedResponse<IAPIFullRepository>(response)
    } catch (e) {
      if (e instanceof APIError) {
        if (org !== null) {
          throw new Error(
            `Unable to create repository for organization '${org.login}'. Verify that the repository does not already exist and that you have permission to create a repository there.`
          )
        }
        throw e
      }

      log.error(`createRepository: failed with endpoint ${this.endpoint}`, e)
      throw new Error(
        `Unable to publish repository. Please check if you have an internet connection and try again.`
      )
    }
  }

  /** Create a new GitHub fork of this repository (owner and name) */
  public async forkRepository(
    owner: string,
    name: string
  ): Promise<IAPIFullRepository> {
    try {
      const apiPath = `/repos/${owner}/${name}/forks`
      const response = await this.ghRequest('POST', apiPath)
      return await parsedResponse<IAPIFullRepository>(response)
    } catch (e) {
      log.error(
        `forkRepository: failed to fork ${owner}/${name} at endpoint: ${this.endpoint}`,
        e
      )
      throw e
    }
  }

  /**
   * Fetch the issues with the given state that have been created or updated
   * since the given date.
   */
  public async fetchIssues(
    owner: string,
    name: string,
    state: 'open' | 'closed' | 'all',
    since: Date | null
  ): Promise<ReadonlyArray<IAPIIssue>> {
    const params: { [key: string]: string } = {
      state,
    }
    if (since && !isNaN(since.getTime())) {
      params.since = toGitHubIsoDateString(since)
    }

    const url = urlWithQueryString(`repos/${owner}/${name}/issues`, params)
    try {
      const issues = await this.fetchAll<IAPIIssue>(url)

      // PRs are issues! But we only want Really Seriously Issues.
      return issues.filter((i: any) => !i.pullRequest)
    } catch (e) {
      log.warn(`fetchIssues: failed for repository ${owner}/${name}`, e)
      throw e
    }
  }

  /** Fetch all open pull requests in the given repository. */
  public async fetchAllOpenPullRequests(owner: string, name: string) {
    const url = urlWithQueryString(`repos/${owner}/${name}/pulls`, {
      state: 'open',
    })
    try {
      return await this.fetchAll<IAPIPullRequest>(url)
    } catch (e) {
      log.warn(`failed fetching open PRs for repository ${owner}/${name}`, e)
      throw e
    }
  }

  /**
   * Fetch all pull requests in the given repository that have been
   * updated on or after the provided date.
   *
   * Note: The GitHub API doesn't support providing a last-updated
   * limitation for PRs like it does for issues so we're emulating
   * the issues API by sorting PRs descending by last updated and
   * only grab as many pages as we need to until we no longer receive
   * PRs that have been update more recently than the `since`
   * parameter.
   *
   * If there's more than `maxResults` updated PRs since the last time
   * we fetched this method will throw an error such that we can abort
   * this strategy and commence loading all open PRs instead.
   */
  public async fetchUpdatedPullRequests(
    owner: string,
    name: string,
    since: Date,
    // 320 is chosen because with a ramp-up page size starting with
    // a page size of 10 we'll reach 320 in exactly 7 pages. See
    // getNextPagePathWithIncreasingPageSize
    maxResults = 320
  ) {
    const sinceTime = since.getTime()
    const url = urlWithQueryString(`repos/${owner}/${name}/pulls`, {
      state: 'all',
      sort: 'updated',
      direction: 'desc',
    })

    try {
      const prs = await this.fetchAll<IAPIPullRequest>(url, {
        // We use a page size smaller than our default 100 here because we
        // expect that the majority use case will return much less than
        // 100 results. Given that as long as _any_ PR has changed we'll
        // get the full list back (PRs doesn't support ?since=) we want
        // to keep this number fairly conservative in order to not use
        // up bandwidth needlessly while balancing it such that we don't
        // have to use a lot of requests to update our database. We then
        // ramp up the page size (see getNextPagePathWithIncreasingPageSize)
        // if it turns out there's a lot of updated PRs.
        perPage: 10,
        getNextPagePath: getNextPagePathWithIncreasingPageSize,
        continue(results) {
          if (results.length >= maxResults) {
            throw new MaxResultsError('got max pull requests, aborting')
          }

          // Given that we sort the results in descending order by their
          // updated_at field we can safely say that if the last item
          // is modified after our sinceTime then haven't reached the
          // end of updated PRs.
          const last = results.at(-1)
          return last !== undefined && Date.parse(last.updated_at) > sinceTime
        },
        // We can't ignore errors here as that might mean that we haven't
        // retrieved enough pages to fully capture the changes since the
        // last time we updated. Ignoring errors here would mean that we'd
        // store an incorrect lastUpdated field in the database.
        suppressErrors: false,
      })
      return prs.filter(pr => Date.parse(pr.updated_at) >= sinceTime)
    } catch (e) {
      log.warn(`failed fetching updated PRs for repository ${owner}/${name}`, e)
      throw e
    }
  }

  /**
   * Fetch a single pull request in the given repository
   */
  public async fetchPullRequest(owner: string, name: string, prNumber: string) {
    try {
      const path = `/repos/${owner}/${name}/pulls/${prNumber}`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIPullRequest>(response)
    } catch (e) {
      log.warn(`failed fetching PR for ${owner}/${name}/pulls/${prNumber}`, e)
      throw e
    }
  }

  /**
   * Fetch a single pull request review in the given repository
   */
  public async fetchPullRequestReview(
    owner: string,
    name: string,
    prNumber: string,
    reviewId: string
  ) {
    try {
      const path = `/repos/${owner}/${name}/pulls/${prNumber}/reviews/${reviewId}`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIPullRequestReview>(response)
    } catch (e) {
      log.debug(
        `failed fetching PR review ${reviewId} for ${owner}/${name}/pulls/${prNumber}`,
        e
      )
      return null
    }
  }

  /** Fetches all reviews from a given pull request. */
  public async fetchPullRequestReviews(
    owner: string,
    name: string,
    prNumber: string
  ) {
    try {
      const path = `/repos/${owner}/${name}/pulls/${prNumber}/reviews`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIPullRequestReview[]>(response)
    } catch (e) {
      log.debug(
        `failed fetching PR reviews for ${owner}/${name}/pulls/${prNumber}`,
        e
      )
      return []
    }
  }

  /** Fetches all review comments from a given pull request. */
  public async fetchPullRequestReviewComments(
    owner: string,
    name: string,
    prNumber: string,
    reviewId: string
  ) {
    try {
      const path = `/repos/${owner}/${name}/pulls/${prNumber}/reviews/${reviewId}/comments`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIComment[]>(response)
    } catch (e) {
      log.debug(
        `failed fetching PR review comments for ${owner}/${name}/pulls/${prNumber}`,
        e
      )
      return []
    }
  }

  /** Fetches all review comments from a given pull request. */
  public async fetchPullRequestComments(
    owner: string,
    name: string,
    prNumber: string
  ) {
    try {
      const path = `/repos/${owner}/${name}/pulls/${prNumber}/comments`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIComment[]>(response)
    } catch (e) {
      log.debug(
        `failed fetching PR comments for ${owner}/${name}/pulls/${prNumber}`,
        e
      )
      return []
    }
  }

  /** Fetches all comments from a given issue. */
  public async fetchIssueComments(
    owner: string,
    name: string,
    issueNumber: string
  ) {
    try {
      const path = `/repos/${owner}/${name}/issues/${issueNumber}/comments`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIComment[]>(response)
    } catch (e) {
      log.debug(
        `failed fetching issue comments for ${owner}/${name}/issues/${issueNumber}`,
        e
      )
      return []
    }
  }

  /**
   * Get the combined status for the given ref.
   */
  public async fetchCombinedRefStatus(
    owner: string,
    name: string,
    ref: string,
    reloadCache: boolean = false
  ): Promise<IAPIRefStatus | null> {
    const safeRef = encodeURIComponent(ref)
    const path = `repos/${owner}/${name}/commits/${safeRef}/status?per_page=100`
    const response = await this.ghRequest('GET', path, {
      reloadCache,
    })

    try {
      return await parsedResponse<IAPIRefStatus>(response)
    } catch (err) {
      log.debug(
        `Failed fetching check runs for ref ${ref} (${owner}/${name})`,
        err
      )
      return null
    }
  }

  /**
   * Get any check run results for the given ref.
   */
  public async fetchRefCheckRuns(
    owner: string,
    name: string,
    ref: string,
    reloadCache: boolean = false
  ): Promise<IAPIRefCheckRuns | null> {
    const safeRef = encodeURIComponent(ref)
    const path = `repos/${owner}/${name}/commits/${safeRef}/check-runs?per_page=100`
    const headers = {
      Accept: 'application/vnd.github.antiope-preview+json',
    }

    const response = await this.ghRequest('GET', path, {
      customHeaders: headers,
      reloadCache,
    })

    try {
      return await parsedResponse<IAPIRefCheckRuns>(response)
    } catch (err) {
      log.debug(
        `Failed fetching check runs for ref ${ref} (${owner}/${name})`,
        err
      )
      return null
    }
  }

  /**
   * List workflow runs for a repository filtered by branch and event type of
   * pull_request
   */
  public async fetchPRWorkflowRunsByBranchName(
    owner: string,
    name: string,
    branchName: string
  ): Promise<IAPIWorkflowRuns | null> {
    const path = `repos/${owner}/${name}/actions/runs?event=pull_request&branch=${encodeURIComponent(
      branchName
    )}`
    const customHeaders = {
      Accept: 'application/vnd.github.antiope-preview+json',
    }
    const response = await this.ghRequest('GET', path, { customHeaders })
    try {
      return await parsedResponse<IAPIWorkflowRuns>(response)
    } catch (err) {
      log.debug(
        `Failed fetching workflow runs for ${branchName} (${owner}/${name})`
      )
    }
    return null
  }

  /**
   * Return the workflow run for a given check_suite_id.
   *
   * A check suite is a reference for a set check runs.
   * A workflow run is a reference for set a of workflows for the GitHub Actions
   * check runner.
   *
   * If a check suite is comprised of check runs ran by actions, there will be
   * one workflow run that represents that check suite. Thus, if this api should
   * either return an empty array indicating there are no actions runs for that
   * check_suite_id (so check suite was not ran by actions) or an array with a
   * single element.
   */
  public async fetchPRActionWorkflowRunByCheckSuiteId(
    owner: string,
    name: string,
    checkSuiteId: number
  ): Promise<IAPIWorkflowRun | null> {
    const path = `repos/${owner}/${name}/actions/runs?event=pull_request&check_suite_id=${checkSuiteId}`
    const customHeaders = {
      Accept: 'application/vnd.github.antiope-preview+json',
    }
    const response = await this.ghRequest('GET', path, { customHeaders })
    try {
      const apiWorkflowRuns = await parsedResponse<IAPIWorkflowRuns>(response)

      if (apiWorkflowRuns.workflow_runs.length > 0) {
        return apiWorkflowRuns.workflow_runs[0]
      }
    } catch (err) {
      log.debug(
        `Failed fetching workflow runs for ${checkSuiteId} (${owner}/${name})`
      )
    }
    return null
  }

  /**
   * List workflow run jobs for a given workflow run
   */
  public async fetchWorkflowRunJobs(
    owner: string,
    name: string,
    workflowRunId: number
  ): Promise<IAPIWorkflowJobs | null> {
    const path = `repos/${owner}/${name}/actions/runs/${workflowRunId}/jobs`
    const customHeaders = {
      Accept: 'application/vnd.github.antiope-preview+json',
    }
    const response = await this.ghRequest('GET', path, {
      customHeaders,
    })
    try {
      return await parsedResponse<IAPIWorkflowJobs>(response)
    } catch (err) {
      log.debug(
        `Failed fetching workflow jobs (${owner}/${name}) workflow run: ${workflowRunId}`
      )
    }
    return null
  }

  /**
   * Triggers GitHub to rerequest an existing check suite, without pushing new
   * code to a repository.
   */
  public async rerequestCheckSuite(
    owner: string,
    name: string,
    checkSuiteId: number
  ): Promise<boolean> {
    const path = `/repos/${owner}/${name}/check-suites/${checkSuiteId}/rerequest`

    return this.ghRequest('POST', path)
      .then(x => x.ok)
      .catch(err => {
        log.debug(
          `Failed retry check suite id ${checkSuiteId} (${owner}/${name})`,
          err
        )
        return false
      })
  }

  /**
   * Re-run all of the failed jobs and their dependent jobs in a workflow run
   * using the id of the workflow run.
   */
  public async rerunFailedJobs(
    owner: string,
    name: string,
    workflowRunId: number
  ): Promise<boolean> {
    const path = `/repos/${owner}/${name}/actions/runs/${workflowRunId}/rerun-failed-jobs`

    return this.ghRequest('POST', path)
      .then(x => x.ok)
      .catch(err => {
        log.debug(
          `Failed to rerun failed workflow jobs for (${owner}/${name}): ${workflowRunId}`,
          err
        )
        return false
      })
  }

  /**
   * Re-run a job and its dependent jobs in a workflow run.
   */
  public async rerunJob(
    owner: string,
    name: string,
    jobId: number
  ): Promise<boolean> {
    const path = `/repos/${owner}/${name}/actions/jobs/${jobId}/rerun`

    return this.ghRequest('POST', path)
      .then(x => x.ok)
      .catch(err => {
        log.debug(
          `Failed to rerun workflow job (${owner}/${name}): ${jobId}`,
          err
        )
        return false
      })
  }

  public async getAvatarToken() {
    return this.ghRequest('GET', `/desktop/avatar-token`)
      .then(x => x.json())
      .then((x: unknown) =>
        x &&
        typeof x === 'object' &&
        'avatar_token' in x &&
        typeof x.avatar_token === 'string'
          ? x.avatar_token
          : null
      )
      .catch(err => {
        log.debug(`Failed to load avatar token`, err)
        return null
      })
  }

  /**
   * Gets a single check suite using its id
   */
  public async fetchCheckSuite(
    owner: string,
    name: string,
    checkSuiteId: number
  ): Promise<IAPICheckSuite | null> {
    const path = `/repos/${owner}/${name}/check-suites/${checkSuiteId}`
    const response = await this.ghRequest('GET', path)

    try {
      return await parsedResponse<IAPICheckSuite>(response)
    } catch (_) {
      log.debug(
        `[fetchCheckSuite] Failed fetch check suite id ${checkSuiteId} (${owner}/${name})`
      )
    }

    return null
  }

  /**
   * Get branch protection info to determine if a user can push to a given branch.
   *
   * Note: if request fails, the default returned value assumes full access for the user
   */
  public async fetchPushControl(
    owner: string,
    name: string,
    branch: string
  ): Promise<IAPIPushControl> {
    const path = `repos/${owner}/${name}/branches/${encodeURIComponent(
      branch
    )}/push_control`

    const headers: any = {
      Accept: 'application/vnd.github.phandalin-preview',
    }

    try {
      const response = await this.ghRequest('GET', path, {
        customHeaders: headers,
      })
      return await parsedResponse<IAPIPushControl>(response)
    } catch (err) {
      log.info(
        `[fetchPushControl] unable to check if branch is potentially pushable`,
        err
      )
      return {
        pattern: null,
        required_signatures: false,
        required_status_checks: [],
        required_approving_review_count: 0,
        required_linear_history: false,
        allow_actor: true,
        allow_deletions: true,
        allow_force_pushes: true,
      }
    }
  }

  public async fetchProtectedBranches(
    owner: string,
    name: string
  ): Promise<ReadonlyArray<IAPIBranch>> {
    const path = `repos/${owner}/${name}/branches?protected=true`
    try {
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIBranch[]>(response)
    } catch (err) {
      log.info(
        `[fetchProtectedBranches] unable to list protected branches`,
        err
      )
      return new Array<IAPIBranch>()
    }
  }

  /**
   * Fetches all repository rules that apply to the provided branch.
   */
  public async fetchRepoRulesForBranch(
    owner: string,
    name: string,
    branch: string
  ): Promise<ReadonlyArray<IAPIRepoRule>> {
    const path = `repos/${owner}/${name}/rules/branches/${encodeURIComponent(
      branch
    )}`
    try {
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIRepoRule[]>(response)
    } catch (err) {
      // If the repository isn't owned by the current user there's no way for us
      // to preemptively check whether rulesets are enabled so we give it a shot
      // but there's no need to log if it fails. Same with 404s, i.e the user
      // doesn't have access to the repo any more or it's been deleted.
      if (!isRulesetsNotEnabledError(err) && !isNotFoundApiError(err)) {
        log.info(
          `[fetchRepoRulesForBranch] unable to fetch repo rules for branch: ${branch} | ${path}`,
          err
        )
      }
      return new Array<IAPIRepoRule>()
    }
  }

  /**
   * Fetches slim versions of all repo rulesets for the given repository. Utilize the cache
   * in IAppState instead of querying this if possible.
   */
  public async fetchAllRepoRulesets(
    owner: string,
    name: string
  ): Promise<ReadonlyArray<IAPISlimRepoRuleset> | null> {
    const path = `repos/${owner}/${name}/rulesets`
    try {
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<ReadonlyArray<IAPISlimRepoRuleset>>(response)
    } catch (err) {
      // If the repository isn't owned by the current user there's no way for us
      // to preemptively check whether rulesets are enabled so we give it a shot
      // but there's no need to log if it fails. Same with 404s, i.e the user
      // doesn't have access to the repo any more or it's been deleted.
      if (!isRulesetsNotEnabledError(err) && !isNotFoundApiError(err)) {
        log.info(
          `[fetchAllRepoRulesets] unable to fetch all repo rulesets | ${path}`,
          err
        )
      }
      return null
    }
  }

  /**
   * Fetches the repo ruleset with the given ID. Utilize the cache in IAppState
   * instead of querying this if possible.
   */
  public async fetchRepoRuleset(
    owner: string,
    name: string,
    id: number
  ): Promise<IAPIRepoRuleset | null> {
    const path = `repos/${owner}/${name}/rulesets/${id}`
    try {
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIRepoRuleset>(response)
    } catch (err) {
      log.info(
        `[fetchRepoRuleset] unable to fetch repo ruleset for ID: ${id} | ${path}`,
        err
      )
      return null
    }
  }

  /**
   * Authenticated requests to a paginating resource such as issues.
   *
   * Follows the GitHub API hypermedia links to get the subsequent
   * pages when available, buffers all items and returns them in
   * one array when done.
   */
  private async fetchAll<T>(path: string, options?: IFetchAllOptions<T>) {
    const buf = new Array<T>()
    const opts: IFetchAllOptions<T> = { perPage: 100, ...options }
    const params = { per_page: `${opts.perPage}` }

    let nextPath: string | null = urlWithQueryString(path, params)
    let page: ReadonlyArray<T> = []
    do {
      const response: Response = await this.ghRequest('GET', nextPath)
      if (opts.suppressErrors !== false && !response.ok) {
        log.warn(`fetchAll: '${path}' returned a ${response.status}`)
        return buf
      }

      page = await parsedResponse<ReadonlyArray<T>>(response)
      if (page) {
        buf.push(...page)
        opts.onPage?.(page)
      }

      nextPath = opts.getNextPagePath
        ? opts.getNextPagePath(response)
        : getNextPagePathFromLink(response)
    } while (nextPath && (!opts.continue || (await opts.continue(buf))))

    return buf
  }

  /** Make an authenticated request to the client's endpoint with its token. */
  private async request(
    endpoint: string,
    method: HTTPMethod,
    path: string,
    options: {
      body?: Object
      customHeaders?: Object
      reloadCache?: boolean
    } = {}
  ): Promise<Response> {
    return await request(
      endpoint,
      this.token,
      method,
      path,
      options.body,
      options.customHeaders,
      options.reloadCache
    )
  }

  /**
   * Make an authenticated request to the client's endpoint with its token.
   * Used for GitHub API requests.
   */
  private async ghRequest(
    method: HTTPMethod,
    path: string,
    options: {
      body?: Object
      customHeaders?: Object
      reloadCache?: boolean
    } = {}
  ): Promise<Response> {
    const response = await this.request(this.endpoint, method, path, options)

    // Only consider invalid token when the status is 401 and the response has
    // the X-GitHub-Request-Id header, meaning it comes from GH(E) and not from
    // any kind of proxy/gateway. For more info see #12943
    // We're also not considering a token has been invalidated when the reason
    // behind a 401 is the fact that any kind of 2 factor auth is required.
    if (
      response.status === HttpStatusCode.Unauthorized &&
      response.headers.has('X-GitHub-Request-Id') &&
      !response.headers.has('X-GitHub-OTP')
    ) {
      API.emitTokenInvalidated(this.endpoint, this.token)
    }

    tryUpdateEndpointVersionFromResponse(this.endpoint, response)

    return response
  }

  /**
   * Make an authenticated request to the client's Copilot endpoint with its
   * token. Used for Copilot API requests.
   */
  private async copilotRequest(
    path: string,
    message: string
  ): Promise<CopilotChatCompletionResponse> {
    if (!this.copilotEndpoint) {
      throw new Error('No Copilot endpoint available')
    }

    const response = await this.request(this.copilotEndpoint, 'POST', path, {
      body: {
        messages: [
          {
            role: 'user',
            content: message,
          },
        ],
        stream: false,
        response_format: {
          type: 'json_object',
        },
      },
      customHeaders: {
        'X-Initiator': 'user',
        'X-Interaction-ID': uuid(),
        'X-Interaction-Type': 'generateCommitMessage',
      },
    })

    if (response.status === HttpStatusCode.TooManyRequests) {
      const retryAfter = response.headers.get('Retry-After')
      if (retryAfter) {
        throw new CopilotError(
          `Rate limited, retry after ${retryAfter} seconds.`,
          response.status
        )
      } else {
        throw new CopilotError(
          'Rate limited, try again in a few minutes.',
          response.status
        )
      }
    } else if (response.status === HttpStatusCode.PaymentRequired) {
      const errorMsg =
        (await response.text()) || 'You have reached your quota limit.'

      throw new CopilotError(errorMsg, response.status)
    } else if (response.status === HttpStatusCode.Unauthorized) {
      throw new CopilotError(
        'Unauthorized: error with authentication.',
        response.status
      )
    } else if (response.status === HttpStatusCode.Forbidden) {
      const body = await response.text()
      if (body.includes('unauthorized: not licensed to use Copilot')) {
        throw new CopilotError(
          'Unauthorized: not licensed to use Copilot.',
          response.status
        )
      } else if (
        body.includes(
          'unauthorized: not authorized to use this Copilot feature',
          response.status
        )
      ) {
        throw new CopilotError(
          'Unauthorized: not authorized to use this Copilot feature.',
          response.status
        )
      } else if (
        body.includes('integration does not have GitHub chat enabled')
      ) {
        throw new CopilotError(
          'Integration does not have GitHub chat enabled.',
          response.status
        )
      } else {
        throw new CopilotError('Unauthorized: unknown.', response.status)
      }
    } else if (response.status === 466) {
      throw new CopilotError(
        'Client issue: unsupported API version.',
        response.status
      )
    } else if (response.status >= HttpStatusCode.BadRequest) {
      const internalError = `Internal server error, code: ${
        response.status
      }, request ID: ${response.headers.get('X-Github-Request-Id')}.`
      console.error(
        `Copilot request failed with status ${response.status}: ${internalError}`
      )
      throw new CopilotError(
        'Something went wrong. Please, try again later.',
        response.status
      )
    }

    const text = await response.text()

    // Responses include multiple lines starting with "data: " followed by
    // a JSON object. We're only interested in the JSON object of the first line.
    const lines = text.split('\n')
    const DataLinePrefix = 'data: '

    for (const line of lines) {
      if (line.startsWith(DataLinePrefix)) {
        const json = JSON.parse(line.substring(DataLinePrefix.length))
        return json as CopilotChatCompletionResponse
      }
    }

    throw new Error('No data line found in response')
  }

  /**
   * Get the allowed poll interval for fetching. If an error occurs it will
   * return null.
   */
  public async getFetchPollInterval(
    owner: string,
    name: string
  ): Promise<number | null> {
    const path = `repos/${owner}/${name}/git`
    try {
      const response = await this.ghRequest('HEAD', path)
      const interval = response.headers.get('x-poll-interval')
      if (interval) {
        const parsed = parseInt(interval, 10)
        return isNaN(parsed) ? null : parsed
      }
      return null
    } catch (e) {
      log.warn(`getFetchPollInterval: failed for ${owner}/${name}`, e)
      return null
    }
  }

  /** Fetch the mentionable users for the repository. */
  public async fetchMentionables(
    owner: string,
    name: string,
    etag: string | undefined
  ): Promise<IAPIMentionablesResponse | null> {
    // NB: this custom `Accept` is required for the `mentionables` endpoint.
    const headers: any = {
      Accept: 'application/vnd.github.jerry-maguire-preview',
    }

    if (etag !== undefined) {
      headers['If-None-Match'] = etag
    }

    try {
      const path = `repos/${owner}/${name}/mentionables/users`
      const response = await this.ghRequest('GET', path, {
        customHeaders: headers,
      })

      if (response.status === HttpStatusCode.NotFound) {
        log.warn(`fetchMentionables: '${path}' returned a 404`)
        return null
      }

      if (response.status === HttpStatusCode.NotModified) {
        return null
      }
      const users = await parsedResponse<ReadonlyArray<IAPIMentionableUser>>(
        response
      )
      const etag = response.headers.get('etag') || undefined
      return { users, etag }
    } catch (e) {
      log.warn(`fetchMentionables: failed for ${owner}/${name}`, e)
      return null
    }
  }

  /**
   * Retrieve the public profile information of a user with
   * a given username.
   */
  public async fetchUser(login: string): Promise<IAPIFullIdentity | null> {
    try {
      const response = await this.ghRequest(
        'GET',
        `users/${encodeURIComponent(login)}`
      )

      if (response.status === HttpStatusCode.NotFound) {
        return null
      }

      return await parsedResponse<IAPIFullIdentity>(response)
    } catch (e) {
      log.warn(`fetchUser: failed with endpoint ${this.endpoint}`, e)
      throw e
    }
  }

  /**
   * Fetches the Desktop-specific features that are enabled for the user.
   *
   * @returns An array of strings with the feature flags enabled for the user.
   */
  public async fetchFeatureFlags(): Promise<ReadonlyArray<string> | undefined> {
    try {
      const response = await this.ghRequest('GET', '/desktop_internal/features')
      const featuresResponse = await parsedResponse<IUserFeaturesResponse>(
        response
      )
      return featuresResponse.features
    } catch (e) {
      log.warn(`fetchFeatureFlags: failed with endpoint ${this.endpoint}`, e)
      return undefined
    }
  }

  /**
   * Fetches the Copilot info related to the user (license and API endpoint).
   *
   * @returns Copilot license and API endpoint.
   */
  public async fetchUserCopilotInfo(): Promise<UserCopilotInfo | undefined> {
    // Copilot is not available on GHES
    if (isGHES(this.endpoint)) {
      return undefined
    }

    const graphql = `
    {
      viewer {
        copilotEndpoints {
          api
        }

        isCopilotDesktopEnabled
      }
    }
    `

    try {
      const response = await this.ghRequest('POST', '/graphql', {
        body: { query: graphql },
      })
      if (response === null) {
        return undefined
      }

      const json: ViewerCopilotResponse =
        (await response.json()) as ViewerCopilotResponse
      const { viewer } = json.data
      return {
        copilotEndpoint: viewer.copilotEndpoints.api,
        isCopilotDesktopEnabled: viewer.isCopilotDesktopEnabled,
      }
    } catch (e) {
      log.warn(`fetchUserCopilotInfo: failed with endpoint ${this.endpoint}`, e)
      return undefined
    }
  }

  /**
   * Leverages Copilot to generate the commit details (title and description)
   * for a given diff.
   *
   * @param diff Diff of changes to be committed, in git format
   * @returns Commit details (title and description) generated by Copilot
   */
  public async getDiffChangesCommitMessage(
    diff: string
  ): Promise<ICopilotCommitMessage> {
    try {
      const response = await this.copilotRequest(
        '/agents/github-desktop-commit-message-generation',
        diff
      )

      const choice = response.choices.at(0)

      if (!choice) {
        throw new Error('No choice found in response')
      }

      const message = choice.message.content
      if (!message) {
        throw new Error('No message found in response')
      }

      return JSON.parse(message)
    } catch (e) {
      log.warn(
        `getDiffChangesCommitMessage: failed with endpoint ${this.endpoint}`,
        e
      )
      throw e
    }
  }

  /**
   * Creates a push protection bypass for a repository.
   *
   * This method sends a POST request to the GitHub API to create a bypass
   * for push protection in a specified repository. The bypass is associated
   * with a reason and a placeholder ID.
   *
   * @param owner - The owner of the repository.
   * @param name - The name of the repository.
   * @param reason - The reason for creating the bypass - false_positive, used_in_tests, will_fix_later.
   * @param placeholderId - The placeholder ID associated with the bypass.
   * @param bypassURL - The URL to retry the bypass creation on Github.com in case of failure.
   * @returns A promise that resolves to the response of the bypass creation.
   * @throws An error if the bypass creation fails, including a warning log.
   */
  public async createPushProtectionBypass(
    owner: string,
    name: string,
    reason: BypassReasonType,
    placeholderId: string,
    bypassURL: string
  ): Promise<IAPICreatePushProtectionBypassResponse> {
    const path = `repos/${owner}/${name}/secret-scanning/push-protection-bypasses`
    const body = {
      reason,
      placeholder_id: placeholderId,
    }

    try {
      const response = await this.ghRequest('POST', path, { body })
      return await parsedResponse<IAPICreatePushProtectionBypassResponse>(
        response
      )
    } catch (e) {
      const msg = `Unable to create push protection bypass.

    Repository: ${owner}/${name}
    Reason: ${reason}
    Placeholder Id: ${placeholderId}.

    Try again at: ${bypassURL}`

      log.error(msg, e)
      throw new Error(msg)
    }
  }
}

export async function deleteToken(account: Account) {
  try {
    const creds = Buffer.from(`${ClientID}:${ClientSecret}`).toString('base64')
    const response = await request(
      account.endpoint,
      null,
      'DELETE',
      `applications/${ClientID}/token`,
      { access_token: account.token },
      { Authorization: `Basic ${creds}` }
    )

    return response.status === 204
  } catch (e) {
    log.error(`deleteToken: failed with endpoint ${account.endpoint}`, e)
    return false
  }
}

/** Fetch the user authenticated by the token. */
export async function fetchUser(
  endpoint: string,
  token: string
): Promise<Account> {
  const api = new API(endpoint, token)
  try {
    const [user, emails, copilotInfo, features] = await Promise.all([
      api.fetchAccount(),
      api.fetchEmails(),
      api.fetchUserCopilotInfo(),
      api.fetchFeatureFlags(),
    ])

    return new Account(
      user.login,
      endpoint,
      token,
      emails,
      user.avatar_url,
      user.id,
      user.name || user.login,
      user.plan?.name,
      copilotInfo?.copilotEndpoint,
      copilotInfo?.isCopilotDesktopEnabled,
      features
    )
  } catch (e) {
    log.warn(`fetchUser: failed with endpoint ${endpoint}`, e)
    throw e
  }
}

/**
 * Map a repository's URL to the endpoint associated with it. For example:
 *
 * https://github.com/xixu-me/git-desktop -> https://api.github.com
 * http://github.mycompany.com/my-team/my-project -> http://github.mycompany.com/api
 */
export function getEndpointForRepository(url: string): string {
  const parsed = URL.parse(url)
  if (parsed.hostname === 'github.com') {
    return getDotComAPIEndpoint()
  } else {
    return `${parsed.protocol}//${parsed.hostname}/api`
  }
}

/**
 * Get the URL for the HTML site. For example:
 *
 * https://api.github.com -> https://github.com
 * http://github.mycompany.com/api -> http://github.mycompany.com/
 */
export function getHTMLURL(endpoint: string): string {
  if (envHTMLURL !== undefined) {
    return envHTMLURL
  }

  // In the case of GitHub.com, the HTML site lives on the parent domain.
  //  E.g., https://api.github.com -> https://github.com
  //
  // Whereas with Enterprise, it lives on the same domain but without the
  // API path:
  //  E.g., https://github.mycompany.com/api/v3 -> https://github.mycompany.com
  //
  // We need to normalize them.
  if (endpoint === getDotComAPIEndpoint() && !envEndpoint) {
    return 'https://github.com'
  } else {
    if (isGHE(endpoint)) {
      const url = new window.URL(endpoint)

      url.pathname = '/'

      if (url.hostname.startsWith('api.')) {
        url.hostname = url.hostname.replace(/^api\./, '')
      }

      return url.toString()
    }

    const parsed = URL.parse(endpoint)
    return `${parsed.protocol}//${parsed.hostname}`
  }
}

/**
 * Get the API URL for an HTML URL. For example:
 *
 * http://github.mycompany.com -> http://github.mycompany.com/api/v3
 */
export function getEnterpriseAPIURL(endpoint: string): string {
  if (isGHE(endpoint)) {
    const url = new window.URL(endpoint)

    url.pathname = '/'
    url.hostname = `api.${url.hostname}`

    return url.toString()
  }

  const parsed = URL.parse(endpoint)
  return `${parsed.protocol}//${parsed.hostname}/api/v3`
}

export const getAPIEndpoint = (endpoint: string) =>
  isDotCom(endpoint) ? getDotComAPIEndpoint() : getEnterpriseAPIURL(endpoint)

/** Get github.com's API endpoint. */
export function getDotComAPIEndpoint(): string {
  // NOTE:
  // `DESKTOP_GITHUB_DOTCOM_API_ENDPOINT` only needs to be set if you are
  // developing against a local version of GitHub the Website, and need to debug
  // the server-side interaction. For all other cases you should leave this
  // unset.
  if (envEndpoint && envEndpoint.length > 0) {
    return envEndpoint
  }

  return 'https://api.github.com'
}

/** Get the account for the endpoint. */
export function getAccountForEndpoint(
  accounts: ReadonlyArray<Account>,
  endpoint: string
): Account | null {
  return accounts.find(a => a.endpoint === endpoint) || null
}

export function getOAuthAuthorizationURL(
  endpoint: string,
  state: string
): string {
  const urlBase = getHTMLURL(endpoint)
  const scope = encodeURIComponent(oauthScopes.join(' '))

  return new window.URL(
    `/login/oauth/authorize?client_id=${ClientID}&scope=${scope}&state=${state}`,
    urlBase
  ).toString()
}

export async function requestOAuthToken(
  endpoint: string,
  code: string
): Promise<string | null> {
  try {
    const urlBase = getHTMLURL(endpoint)
    const response = await request(
      urlBase,
      null,
      'POST',
      'login/oauth/access_token',
      {
        client_id: ClientID,
        client_secret: ClientSecret,
        code: code,
      }
    )
    tryUpdateEndpointVersionFromResponse(endpoint, response)

    const result = await parsedResponse<IAPIAccessToken>(response)
    return result.access_token
  } catch (e) {
    log.warn(`requestOAuthToken: failed with endpoint ${endpoint}`, e)
    return null
  }
}

function tryUpdateEndpointVersionFromResponse(
  endpoint: string,
  response: Response
) {
  const gheVersion = response.headers.get('x-github-enterprise-version')
  if (gheVersion !== null) {
    updateEndpointVersion(endpoint, gheVersion)
  }
}

const knownThirdPartyHosts = new Set([
  'dev.azure.com',
  'gitlab.com',
  'bitbucket.org',
  'gitee.com',
  'gitcode.net',
  'huggingface.co',
  'amazonaws.com',
  'visualstudio.com',
])

const isKnownThirdPartyHost = (hostname: string) => {
  if (knownThirdPartyHosts.has(hostname)) {
    return true
  }

  for (const knownHost of knownThirdPartyHosts) {
    if (hostname.endsWith(`.${knownHost}`)) {
      return true
    }
  }

  return false
}

/**
 * Attempts to determine whether or not the url belongs to a GitHub host.
 *
 * This is a best-effort attempt and may return `undefined` if encountering
 * an error making the discovery request
 */
export async function isGitHubHost(url: string) {
  const { hostname } = new window.URL(url)

  const endpoint =
    hostname === 'github.com' || hostname === 'api.github.com'
      ? getDotComAPIEndpoint()
      : getEnterpriseAPIURL(url)

  if (isDotCom(endpoint) || isGHE(endpoint)) {
    return true
  }

  if (isKnownThirdPartyHost(hostname)) {
    return false
  }

  // github.example.com,
  if (/(^|\.)(github)\./.test(hostname)) {
    return true
  }

  // bitbucket.example.com, etc
  if (/(^|\.)(bitbucket|gitlab)\./.test(hostname)) {
    return false
  }

  if (getEndpointVersion(endpoint) !== null) {
    return true
  }

  // Add a unique identifier to the URL to make sure our certificate error
  // supression only catches this request
  const metaUrl = `${endpoint}/meta?ghd=${uuid()}`

  const ac = new AbortController()
  const timeoutId = setTimeout(() => ac.abort(), 2000)
  suppressCertificateErrorFor(metaUrl)
  try {
    const response = await fetch(metaUrl, {
      headers: { 'user-agent': getUserAgent() },
      signal: ac.signal,
      credentials: 'omit',
      method: 'HEAD',
    })

    tryUpdateEndpointVersionFromResponse(endpoint, response)

    return response.headers.has('x-github-request-id')
  } catch (e) {
    log.debug(`isGitHubHost: failed with endpoint ${endpoint}`, e)
    return undefined
  } finally {
    clearTimeout(timeoutId)
    clearCertificateErrorSuppressionFor(metaUrl)
  }
}

const isRulesetsNotEnabledError = (error: any) =>
  error instanceof APIError &&
  error.responseStatus === 403 &&
  /upgrade.*to enable this feature.*/i.test(error.apiError?.message ?? '')

const isNotFoundApiError = (error: any) =>
  error instanceof APIError && error.responseStatus === 404
