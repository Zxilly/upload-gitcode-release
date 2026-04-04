# upload-gitcode-release

`upload-gitcode-release` 是一个 GitHub Action，用于将工作流中的本地文件上传到 GitCode Release。

## Inputs

| Name | Required | Description |
| --- | --- | --- |
| `gitcode-token` | Yes | GitCode Access Token。 |
| `target-repo` | Yes | 目标 GitCode 仓库，格式 `owner/repo`。 |
| `tag` | Yes | 目标 Release 标签。 |
| `name` | No | Release 标题，默认与 `tag` 相同。 |
| `body` | No | Release 描述。 |
| `target-commitish` | No | 目标分支或提交，默认 `main`。 |
| `files` | Yes | 按行分隔的文件路径或 glob 模式。 |
| `fail-if-no-files` | No | 没有匹配文件时是否失败，默认 `true`。 |

## Usage

```yaml
name: Upload assets to GitCode Release

on:
  release:
    types: [published]

jobs:
  upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build files
        run: |
          mkdir -p out
          echo "hello" > out/example.txt

      - name: Upload to GitCode release
        uses: Zxilly/upload-gitcode-release@v1
        with:
          gitcode-token: ${{ secrets.GITCODE_TOKEN }}
          target-repo: your-org/your-repo
          tag: ${{ github.event.release.tag_name }}
          name: ${{ github.event.release.name }}
          body: ${{ github.event.release.body }}
          files: |
            out/*
```


## API

该 Action 通过 GitCode API v5 完成上传流程：

- `POST /api/v5/repos/:owner/:repo/releases` — 创建 Release
- `GET /api/v5/repos/:owner/:repo/releases/:tag/upload_url` — 获取文件上传地址
- `PUT <upload_url>` — 上传文件二进制内容

## Development

```bash
pnpm install
pnpm run lint
pnpm run build
```

打包产物在 `dist/`，`action.yml` 入口为 `dist/index.js`。
