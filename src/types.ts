export interface RepoRef {
  owner: string
  repo: string
}

export interface CreateReleasePayload {
  tag_name: string
  name: string
  body: string
  target_commitish: string
}

export interface GitCodeErrorResponse {
  message?: string
  error_code?: number
}

export interface GitCodeUploadUrlResponse {
  url: string
  headers?: Record<string, string>
}
