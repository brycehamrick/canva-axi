# canva-axi

AXI-compliant CLI for [Canva](https://www.canva.com) — search designs, generate and edit designs, manage folders, brand templates, assets, comments, and exports from the shell, over Canva's official remote MCP server with a one-time browser login. Spec `axi/1.0-2026-07`, Node.js 20+, TypeScript.

`canva-axi` wraps every tool the [Canva MCP server](https://www.canva.dev/docs/apps/mcp/) exposes — not the REST API — and adds the agent ergonomics the raw MCP surface lacks.

## Why an AXI for Canva

The default agent integration for Canva is a remote MCP server. Two problems in practice:

- **Schema overhead.** ~45 MCP tool schemas live in context all session. MCP conditions average 2.3× the input tokens of an AXI CLI per task. This CLI ships none: it emits TOON rows with 3–4 fields, folds multi-step flows (create-and-poll, upload-and-POST, start-perform-commit guidance) into single commands, and pre-computes the counts and statuses agents otherwise round-trip for.
- **Resource overhead.** A resident MCP client (or `mcp-remote` bridge process) stays loaded for the whole session. `canva-axi` opens the MCP endpoint on demand per command, does its work, and exits — nothing idles in the background.

## Install

```
npm install -g canva-axi
canva-axi --help
```

Without a global install, run `npx -y canva-axi <command>`.

Or install the packaged skill for your agent:

```
npx -y skills@latest add brycehamrick/canva-axi --skill canva-axi -g
```

## Authentication

No API keys, no client secrets, no `.env` files. The first run of any command that needs Canva will tell you to log in:

```
canva-axi auth login
```

That single command:

1. Discovers Canva's OAuth endpoints from `https://mcp.canva.com/.well-known/oauth-authorization-server`
2. Dynamically registers a public client (RFC 7591) — no Developer Portal app needed
3. Opens the browser for a PKCE (S256) authorization-code approval over a loopback redirect
4. Caches the access/refresh token in `~/.config/canva-axi/config.json` (0600, atomic writes)

Every later command runs headless with automatic silent token refresh. `CANVA_ACCESS_TOKEN` in the environment overrides the stored token for CI. `auth status --probe` verifies the session live; `auth logout` revokes and deletes.

## Commands

```
# Orientation
canva-axi                                  # connection state + recent designs
canva-axi auth login                       # one-time browser approval
canva-axi tools [--schema <name>]          # live server tool catalog / input schemas

# Discovery
canva-axi design search [query]            # find designs by title keyword
canva-axi design get <ref>                 # metadata: title, owner, URLs, pages
canva-axi design content <ref> [--full]    # read a design's text
canva-axi design pages <ref>               # pages with dimensions
canva-axi shortlink <link>                 # expand a canva.link shortlink

# Generation (AI credits; --confirm gated)
canva-axi design create "<brief>" --confirm        # brief → editable design (polls)
canva-axi generate "<brief>" --confirm             # brief → candidates to choose from
canva-axi generate pick <job> <candidate>          # chosen candidate → real design
canva-axi generate image "<prompt>" [--ref M1] --confirm
canva-axi generate image-job <jobId>               # poll an image job

# Design operations
canva-axi design copy <ref> [--pages 1,3] --confirm
canva-axi design resize <ref> --type "Instagram Story" --confirm
canva-axi design merge <ref> --op insert_pages --from-design <id> --pages 5,6 --confirm
canva-axi design import <url> "<name>" --confirm

# Editing (transaction: draft until commit)
canva-axi edit start <ref>                 # transaction_id + element ids
canva-axi edit perform <txn> --page 1 --op replace_text --element E1 --text "New"
canva-axi edit perform <txn> --page 1 --op find_and_replace_text --find old --text new
canva-axi edit perform <txn> --page 1 --op update_fill --element E2 --asset A1
canva-axi edit commit <txn> --confirm      # persist
canva-axi edit cancel <txn>                # discard

# Images and assets
canva-axi image assets A1,A2               # look up image/video assets
canva-axi image remove-bg <media-id> --confirm
canva-axi image upload-url <url> --confirm # import from public HTTPS
canva-axi image upload <path> --confirm    # local file → single-use URL → POST
canva-axi image layers <asset-id> --confirm # flat image → editable design

# Folders
canva-axi folder search [query]
canva-axi folder ls <id|root> [--type design] [--sort modified_descending]
canva-axi folder create --name "Q4" --parent root --confirm
canva-axi folder move <item-id> <folder-id> --confirm

# Comments
canva-axi comment ls <ref>
canva-axi comment replies <ref> <comment-id>
canva-axi comment add <ref> --message "..." --confirm
canva-axi comment reply <ref> <comment-id> --message "..." --confirm

# Brand templates & autofill (Pro)
canva-axi template kits
canva-axi template search [query] [--brand-kit <id>]
canva-axi template dataset <id>            # autofill fields + types
canva-axi template create <id> --confirm
canva-axi template draft <id> --confirm    # editable draft of a template
canva-axi template publish <ref> --confirm # publish draft back as template
canva-axi autofill --template <id> --data '{"field":"value"}' --confirm
canva-axi autofill fields <ref>            # autofill fields of a design

# Export
canva-axi export formats <ref>             # what's supported, per page
canva-axi export <ref> --format pdf        # download URLs (expire fast)
canva-axi export <ref> --format png --pages 1,3 --lossless

# Canva product help
canva-axi help "How do I add page numbers?"

# Ambient context
canva-axi setup hooks [--project|--remove] # session-start context for Claude Code, Codex, OpenCode
```

Design refs accept the 11-char design id (`D…`) or a full canva.com share URL everywhere.

## Safety model

Your Canva account is live data. The gates:

- **Reads, polls, and exports are ungated.** Exporting renders a file; it never touches the design.
- **`edit start` / `edit perform` are ungated** — edits stay draft inside the transaction; nothing persists until `edit commit`, which requires `--confirm`. Abandoned transactions are discarded by Canva.
- **Everything that persists to the account or spends AI credits requires `--confirm`** and fails with exit 2 *before any network call*: design create/copy/resize/merge/import, generate, image layers/remove-bg/upload, folder create/move, comment add/reply, template create/draft/publish, autofill.
- **No delete exists for designs** in the Canva MCP surface — nothing this CLI can do removes a design.
- `merge --op delete_pages` is the one permanent operation; its help text says so and confirmation is required.
- Errors are structured (TOON on stdout), with `help[]` next-step suggestions and clean exit codes: 0 success, 1 runtime, 2 usage.

## Job model

Canva's MCP tools come in three async flavors; the CLI handles each so agents don't have to:

| Flavor | Tools | CLI behavior |
| --- | --- | --- |
| Server-wrapped job | generate, export, merge, import, resize, autofill, upload-url, help | single call; server polls internally (~1 min) |
| Client-polled job | design create, image layers | starts job, honors `polling_policy.wait_seconds`, follows `continuation_token`, guards against `polled_too_early`; `--wait false` detaches |
| Polled status | generate image | returns `jobId`; `generate image-job <jobId>` polls PENDING → SUCCESS/FAILURE |

## Development

```
npm install
npm test          # vitest (no network, no credentials)
npm run typecheck
npm run skill:check
```

Tests inject fake MCP tool callers; nothing touches the network or a real Canva account.

## Rate limits

Per-tool limits (e.g. `generate-design` 20/min, `search-designs` 100/min) and a global 300/min per-user cap apply; see [MCP tools and rate limits](https://www.canva.dev/docs/apps/mcp/tools/). The CLI maps 429s to a `RATE_LIMIT` error with a wait hint.

## License

MIT
