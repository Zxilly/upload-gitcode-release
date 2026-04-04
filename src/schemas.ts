import { z } from 'zod/v4'

export const uploadUrlResponseSchema = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
})

export const errorResponseSchema = z.object({
  message: z.string().optional(),
  error_code: z.number().optional(),
})
