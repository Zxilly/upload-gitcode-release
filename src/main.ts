import type { CreateReleasePayload, RepoRef } from './types'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as core from '@actions/core'

import * as glob from '@actions/glob'
import { GitCodeApi, HttpError } from './gitcode-api'

const RETRY_TIMES = 3

function parseRepo(input: string, name: string): RepoRef {
  const [owner, repo, ...rest] = input.split('/')
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`${name} must be in owner/repo format, got: ${input}`)
  }
  return { owner, repo }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetry<T>(label: string, fn: () => Promise<T>, retries = RETRY_TIMES): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn()
    }
    catch (error) {
      lastError = error
      if (attempt < retries) {
        const waitMs = attempt * 1000
        core.warning(`${label} failed on attempt ${attempt}/${retries}, retrying in ${waitMs}ms`)
        await sleep(waitMs)
      }
    }
  }

  throw lastError
}

async function collectFiles(patterns: string[]): Promise<string[]> {
  const files = new Set<string>()

  for (const pattern of patterns) {
    const globber = await glob.create(pattern)
    for await (const filePath of globber.globGenerator()) {
      files.add(filePath)
    }
  }

  return [...files]
}

async function ensureRelease(api: GitCodeApi, repo: RepoRef, payload: CreateReleasePayload): Promise<void> {
  const { status, body } = await withRetry('create release', () => api.createRelease(repo, payload))

  if (status >= 200 && status < 300) {
    core.info(`Created release ${payload.tag_name}`)
    return
  }

  const error = api.parseError(body)
  if (status === 409 || error?.error_code === 409) {
    core.info(`Release ${payload.tag_name} already exists, continue uploading files`)
    return
  }

  throw new Error(`Failed to create release. status=${status}, body=${body}`)
}

async function uploadOneFile(api: GitCodeApi, repo: RepoRef, tag: string, filePath: string): Promise<void> {
  const fileName = path.basename(filePath)
  const buf = await readFile(filePath)
  const content = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer

  const uploadInfo = await withRetry(`get upload url for ${fileName}`, () => api.getUploadUrl(repo, tag, fileName))
  await withRetry(`upload ${fileName}`, () => api.uploadBinary(uploadInfo.url, uploadInfo.headers, content))
}

async function run(): Promise<void> {
  const gitcodeToken = core.getInput('gitcode-token', { required: true })
  const targetRepoInput = core.getInput('target-repo', { required: true })
  const tag = core.getInput('tag', { required: true })
  const name = core.getInput('name') || tag
  const body = core.getInput('body')
  const targetCommitish = core.getInput('target-commitish') || 'main'
  const filePatterns = core.getMultilineInput('files', { required: true })
  const failIfNoFiles = core.getBooleanInput('fail-if-no-files')

  const repo = parseRepo(targetRepoInput, 'target-repo')
  const files = await collectFiles(filePatterns)

  if (files.length === 0) {
    const message = `No files matched patterns: ${filePatterns.join(', ')}`
    if (failIfNoFiles) {
      throw new Error(message)
    }
    core.warning(message)
    return
  }

  core.info(`Found ${files.length} file(s) to upload`)

  const api = new GitCodeApi(gitcodeToken)
  await ensureRelease(api, repo, {
    tag_name: tag,
    name,
    body,
    target_commitish: targetCommitish,
  })

  for (const filePath of files) {
    const fileName = path.basename(filePath)
    core.info(`Uploading ${fileName} from ${filePath}`)
    await uploadOneFile(api, repo, tag, filePath)
    core.info(`Uploaded ${fileName}`)
  }

  core.info(`Done. Uploaded ${files.length} file(s) to ${targetRepoInput}@${tag}`)
}

run().catch((error) => {
  if (error instanceof HttpError) {
    core.setFailed(`${error.message}. status=${error.status}, body=${error.body}`)
    return
  }

  core.setFailed(error instanceof Error ? error.message : String(error))
})
