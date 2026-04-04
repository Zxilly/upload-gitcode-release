import type {
  CreateReleasePayload,
  GitCodeErrorResponse,
  GitCodeUploadUrlResponse,
  RepoRef,
} from './types'
import { errorResponseSchema, uploadUrlResponseSchema } from './schemas'

const GITCODE_API_BASE = 'https://api.gitcode.com/api/v5'

export class HttpError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.status = status
    this.body = body
  }
}

export class GitCodeApi {
  private readonly token: string

  constructor(token: string) {
    this.token = token
  }

  async createRelease(repo: RepoRef, payload: CreateReleasePayload): Promise<{ status: number, body: string }> {
    const response = await fetch(this.repoUrl(repo, '/releases'), {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    return { status: response.status, body: await response.text() }
  }

  async getUploadUrl(repo: RepoRef, tag: string, fileName: string): Promise<GitCodeUploadUrlResponse> {
    const url = this.repoUrl(repo, `/releases/${encodeURIComponent(tag)}/upload_url`, { file_name: fileName })

    const response = await fetch(url, {
      method: 'GET',
      headers: { ...this.authHeaders(), Accept: 'application/json' },
    })

    const body = await response.text()
    if (!response.ok) {
      throw new HttpError(`Failed to get upload URL for ${fileName}`, response.status, body)
    }

    const json = safeJsonParse(body)
    if (json === undefined) {
      throw new Error(`Invalid JSON in upload URL response for ${fileName}: ${body}`)
    }

    const result = uploadUrlResponseSchema.safeParse(json)
    if (!result.success) {
      throw new Error(`Invalid upload URL response for ${fileName}: ${body}`)
    }

    return result.data
  }

  async uploadBinary(uploadUrl: string, headers: Record<string, string> | undefined, content: ArrayBuffer): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: headers ?? {},
      body: content,
    })

    if (!response.ok) {
      throw new HttpError('Failed to upload file', response.status, await response.text())
    }
  }

  parseError(body: string): GitCodeErrorResponse | null {
    const json = safeJsonParse(body)
    if (json === undefined)
      return null
    const result = errorResponseSchema.safeParse(json)
    return result.success ? result.data : null
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` }
  }

  private repoUrl(repo: RepoRef, suffix: string, query: Record<string, string> = {}): string {
    return this.buildUrl(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}${suffix}`, query)
  }

  private buildUrl(path: string, query: Record<string, string> = {}): string {
    const url = new URL(`${GITCODE_API_BASE}${path}`)
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
    return url.toString()
  }
}

function safeJsonParse(body: string): unknown | undefined {
  try {
    return JSON.parse(body)
  }
  catch {
    return undefined
  }
}
