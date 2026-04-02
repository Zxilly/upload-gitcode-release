import type {
  CreateReleasePayload,
  GitCodeErrorResponse,
  GitCodeUploadUrlResponse,
  RepoRef
} from './types'

const GITCODE_API_BASE = 'https://api.gitcode.com/api/v5'

export class HttpError extends Error {
  public readonly status: number
  public readonly body: string

  public constructor(message: string, status: number, body: string) {
    super(message)
    this.status = status
    this.body = body
  }
}

export class GitCodeApi {
  private readonly token: string

  public constructor(token: string) {
    this.token = token
  }

  public async createRelease(repo: RepoRef, payload: CreateReleasePayload): Promise<{status: number; body: string}> {
    const response = await fetch(this.withToken(`/repos/${repo.owner}/${repo.repo}/releases`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    })

    return {status: response.status, body: await response.text()}
  }

  public async getUploadUrl(repo: RepoRef, tag: string, fileName: string): Promise<GitCodeUploadUrlResponse> {
    const url = this.withToken(
      `/repos/${repo.owner}/${repo.repo}/releases/${encodeURIComponent(tag)}/upload_url`,
      {file_name: fileName}
    )

    const response = await fetch(url, {
      method: 'GET',
      headers: {Accept: 'application/json'}
    })

    const body = await response.text()
    if (!response.ok) {
      throw new HttpError(`Failed to get upload URL for ${fileName}`, response.status, body)
    }

    const parsed = safeParseJson<GitCodeUploadUrlResponse>(body)
    if (!parsed || typeof parsed.url !== 'string' || parsed.url.length === 0) {
      throw new Error(`Invalid upload URL response for ${fileName}: ${body}`)
    }

    return parsed
  }

  public async uploadBinary(uploadUrl: string, headers: Record<string, string> | undefined, content: ArrayBuffer): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: headers ?? {},
      body: content
    })

    if (!response.ok) {
      throw new HttpError('Failed to upload file', response.status, await response.text())
    }
  }

  public parseError(body: string): GitCodeErrorResponse | null {
    return safeParseJson<GitCodeErrorResponse>(body)
  }

  private withToken(path: string, query: Record<string, string> = {}): string {
    const url = new URL(`${GITCODE_API_BASE}${path}`)
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
    url.searchParams.set('access_token', this.token)
    return url.toString()
  }
}

function safeParseJson<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T
  } catch {
    return null
  }
}
