import * as React from 'react'

import { SupportedPlatform, getPlatformConfig, getSupportedPlatforms } from '../../lib/platform-support'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { LinkButton } from '../lib/link-button'
import { PasswordTextBox } from '../lib/password-text-box'
import { Ref } from '../lib/ref'
import { Row } from '../lib/row'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'

interface IMultiPlatformAuthenticationProps {
  /** The remote URL we're trying to authenticate against */
  readonly remoteUrl: string
  
  /** The detected platform for this remote */
  readonly platform: SupportedPlatform
  
  /** The username if already known */
  readonly username?: string
  
  /** Called when the user selects a different platform */
  readonly onPlatformChange: (platform: SupportedPlatform) => void
  
  /** Called when the user saves their credentials */
  readonly onSave: (platform: SupportedPlatform, username: string, password: string) => void
  
  /** Called when the user dismisses the dialog */
  readonly onDismiss: () => void
}

interface IMultiPlatformAuthenticationState {
  readonly platform: SupportedPlatform
  readonly username: string
  readonly password: string
}

/** Dialog for authenticating to multiple git hosting platforms */
export class MultiPlatformAuthentication extends React.Component<
  IMultiPlatformAuthenticationProps,
  IMultiPlatformAuthenticationState
> {
  public constructor(props: IMultiPlatformAuthenticationProps) {
    super(props)

    this.state = {
      platform: props.platform,
      username: props.username ?? '',
      password: '',
    }
  }

  public render() {
    const { platform, username, password } = this.state
    const disabled = !password.length || !username.length

    return (
      <Dialog
        id="multi-platform-auth"
        title={__DARWIN__ ? `Authentication Failed` : `Authentication failed`}
        onDismissed={this.props.onDismiss}
        onSubmit={this.save}
        role="alertdialog"
        ariaDescribedBy="multi-platform-auth-error"
      >
        <DialogContent>
          <p id="multi-platform-auth-error">
            We were unable to authenticate with{' '}
            <Ref>{this.props.remoteUrl}</Ref>. Please enter your credentials
            to try again.
          </p>

          <Row>
            <Select
              label="Platform"
              value={platform}
              onChange={this.onPlatformChange}
            >
              {getSupportedPlatforms()
                .filter(p => p !== SupportedPlatform.Generic)
                .map(p => {
                  const cfg = getPlatformConfig(p)
                  return (
                    <option key={p} value={p}>
                      {cfg.displayName}
                    </option>
                  )
                })}
            </Select>
          </Row>

          {this.props.username === undefined && (
            <Row>
              <TextBox
                label="Username"
                autoFocus={true}
                value={username}
                onValueChanged={this.onUsernameChange}
              />
            </Row>
          )}

          <Row>
            <PasswordTextBox
              label={this.getPasswordLabel()}
              value={password}
              onValueChanged={this.onPasswordChange}
              ariaDescribedBy="multi-platform-auth-password-description"
            />
          </Row>

          <Row>
            <div id="multi-platform-auth-password-description">
              {this.getPasswordDescription()}
            </div>
          </Row>
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup okButtonDisabled={disabled} />
        </DialogFooter>
      </Dialog>
    )
  }

  private getPasswordLabel(): string {
    switch (this.state.platform) {
      case SupportedPlatform.GitHub:
        return 'Personal Access Token or Password'
      case SupportedPlatform.GitLab:
        return 'Personal Access Token or Password'
      case SupportedPlatform.Bitbucket:
        return 'App Password'
      case SupportedPlatform.Gitee:
        return 'Personal Access Token or Password'
      case SupportedPlatform.GitCode:
        return 'Personal Access Token or Password'
      case SupportedPlatform.HuggingFace:
        return 'Access Token'
      default:
        return 'Password'
    }
  }

  private getPasswordDescription(): JSX.Element {
    switch (this.state.platform) {
      case SupportedPlatform.GitHub:
        return (
          <>
            For security, we recommend using a Personal Access Token. 
            Learn how to create one in our{' '}
            <LinkButton uri="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token">
              GitHub integration docs
            </LinkButton>.
          </>
        )
      case SupportedPlatform.GitLab:
        return (
          <>
            For security, we recommend using a Personal Access Token with 'api' scope. 
            Learn how to create one in our{' '}
            <LinkButton uri="https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html">
              GitLab integration docs
            </LinkButton>.
          </>
        )
      case SupportedPlatform.Bitbucket:
        return (
          <>
            Bitbucket requires App Passwords for authentication. 
            Learn how to create one in our{' '}
            <LinkButton uri="https://support.atlassian.com/bitbucket-cloud/docs/app-passwords/">
              Bitbucket integration docs
            </LinkButton>.
          </>
        )
      case SupportedPlatform.Gitee:
        return (
          <>
            For security, we recommend using a Personal Access Token. 
            Learn how to create one in the{' '}
            <LinkButton uri="https://gitee.com/profile/personal_access_tokens">
              Gitee Personal Access Tokens
            </LinkButton> section.
          </>
        )
      case SupportedPlatform.GitCode:
        return (
          <>
            For security, we recommend using a Personal Access Token. 
            Learn how to create one in your GitCode account settings.
          </>
        )
      case SupportedPlatform.HuggingFace:
        return (
          <>
            Hugging Face requires an Access Token for authentication. 
            Learn how to create one in your{' '}
            <LinkButton uri="https://huggingface.co/settings/tokens">
              Hugging Face settings
            </LinkButton>.
          </>
        )
      default:
        return <>Enter your credentials for this Git hosting service.</>
    }
  }

  private onPlatformChange = (platform: SupportedPlatform) => {
    this.setState({ platform })
    this.props.onPlatformChange(platform)
  }

  private onUsernameChange = (value: string) => {
    this.setState({ username: value })
  }

  private onPasswordChange = (value: string) => {
    this.setState({ password: value })
  }

  private save = () => {
    this.props.onSave(
      this.state.platform,
      this.props.username ?? this.state.username,
      this.state.password
    )
    this.props.onDismiss()
  }
}
