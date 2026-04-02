import * as core from '@actions/core'
import * as glob from '@actions/glob'
import {readFile} from 'node:fs/promises'
import path from 'node:path'

type RepoRef = {
  owner: string
  repo: string
}

type GitCodeUploadInfo = {
  url: string
  headers?: Record<string, string>
}

const GITCODE_API_BASE = 'https://api.gitcode.com/api/v5'
const RETRY_TIMES = 3

function parseRepo(input: string, name: string): RepoRef {
  const [owner, repo, ...rest] = input.split('/')
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`${name} must be in owner/repo format, got: ${input}`)
  }
  return {owner, repo}
}

function getMultilineInput(name: string, required = false): string[] {
  const lines = core
    .getInput(name, {required})
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (required && lines.length === 0) {
    throw new Error(`Input "${name}" is required and must contain at least one value`)
  }

  return lines
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetry<T>(label: string, fn: () => Promise<T>, retries = RETRY_TIMES): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        const delayMs = attempt * 1000
        core.warning(`${label} failed on attempt ${attempt}/${retries}, retrying in ${delayMs}ms`)
        await sleep(delayMs)
      }
    }
  }

  throw lastError
}

async function request(url: string, init: RequestInit): Promise<Response> {
  return withRetry(`${init.method ?? 'GET'} ${url}`, () => fetch(url, init))
}

async function createReleaseIfNeeded(
  repo: RepoRef,
  token: string,
  release: {tag_name: string; name: string; body: string; target_commitish: string}
): Promise<void> {
  const url = `${GITCODE_API_BASE}/repos/${repo.owner}/${repo.repo}/releases?access_token=${encodeURIComponent(token)}`

  const response = await request(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(release)
  })

  if (response.ok) {
    core.info(`Created release ${release.tag_name}`)
    return
  }

  const text = await response.text()
  let errorCode: number | undefined
  try {
    const parsed = JSON.parse(text) as {error_code?: number}
    errorCode = parsed.error_code
  } catch {
    // ignore parse failure
  }

  if (response.status === 409 || errorCode === 409) {
    core.info(`Release ${release.tag_name} already exists, continue uploading assets`)
    return
  }

  throw new Error(`Failed to create release. status=${response.status}, body=${text}`)
}

async function getUploadUrl(repo: RepoRef, token: string, tag: string, fileName: string): Promise<GitCodeUploadInfo> {
  const url = `${GITCODE_API_BASE}/repos/${repo.owner}/${repo.repo}/releases/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(fileName)}&access_token=${encodeURIComponent(token)}`

  const response = await request(url, {
    method: 'GET',
    headers: {Accept: 'application/json'}
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Failed to get upload URL for ${fileName}. status=${response.status}, body=${text}`)
  }

  const parsed = JSON.parse(text) as GitCodeUploadInfo
  if (!parsed.url) {
    throw new Error(`Invalid upload URL response for ${fileName}: ${text}`)
  }

  return parsed
}

async function uploadFile(uploadInfo: GitCodeUploadInfo, filePath: string): Promise<void> {
  const fileName = path.basename(filePath)
  const content = await readFile(filePath)

  const response = await request(uploadInfo.url, {
    method: 'PUT',
    headers: uploadInfo.headers ?? {},
    body: content
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to upload ${fileName}. status=${response.status}, body=${text}`)
  }
}

async function collectFiles(patterns: string[]): Promise<string[]> {
  const results = new Set<string>()

  for (const pattern of patterns) {
    const globber = await glob.create(pattern)
    for await (const file of globber.globGenerator()) {
      results.add(file)
    }
  }

  return [...results]
}

async function run(): Promise<void> {
  const gitcodeToken = core.getInput('gitcode-token', {required: true})
  const targetRepoInput = core.getInput('target-repo', {required: true})
  const tagName = core.getInput('tag', {required: true})
  const releaseName = core.getInput('name') || tagName
  const releaseBody = core.getInput('body')
  const targetCommitish = core.getInput('target-commitish') || process.env.GITHUB_SHA || 'main'
  const filePatterns = getMultilineInput('files', true)
  const failIfNoFiles = core.getBooleanInput('fail-if-no-files')

  const targetRepo = parseRepo(targetRepoInput, 'target-repo')
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

  await createReleaseIfNeeded(targetRepo, gitcodeToken, {
    tag_name: tagName,
    name: releaseName,
    body: releaseBody,
    target_commitish: targetCommitish
  })

  for (const filePath of files) {
    const fileName = path.basename(filePath)
    core.info(`Uploading ${fileName} from ${filePath}`)
    const uploadInfo = await getUploadUrl(targetRepo, gitcodeToken, tagName, fileName)
    await uploadFile(uploadInfo, filePath)
    core.info(`Uploaded ${fileName}`)
  }

  core.info(`Done. Uploaded ${files.length} file(s) to ${targetRepoInput}@${tagName}`)
}

run().catch(error => {
  core.setFailed(error instanceof Error ? error.message : String(error))
})
