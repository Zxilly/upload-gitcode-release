import type { z } from 'zod/v4'
import type { errorResponseSchema, uploadUrlResponseSchema } from './schemas'

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

export type GitCodeErrorResponse = z.infer<typeof errorResponseSchema>

export type GitCodeUploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>
