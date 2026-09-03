# Security Policy

## Reporting a vulnerability

If you find a security vulnerability, **do not** open a public issue. Please report it privately:

- Email: **support@jsray.org**
- Official site: https://jsray.org

We aim to acknowledge reports within 72 hours.

## Scope

This CLI reads files or stdin and writes ANSI escape sequences to a terminal:

- Input text is emitted as data. A payload that lets file content inject **unintended escape sequences** — cursor manipulation, terminal-title rewriting, or anything that alters terminal state — is a **high-severity** vulnerability.
- With `--color none` the output must round-trip the input byte-for-byte; a mismatch is a correctness bug worth reporting.
- The CLI performs no network access and writes no files.

Vulnerabilities in the bundled JSRay Core snapshot belong to
[JSRay Core](https://github.com/jsrayorg/jsray) — report them the same way, and
fixes reach this project through the next Core sync.

Out of scope:
- Issues that only reproduce with a renderer other than JSRay Core swapped in through the adapter hooks.
- Known catastrophic backtracking in grammar rules — please report it as an issue, not as a vulnerability.

## Supported versions

| Version | Security updates |
|---|---|
| 0.0.1-beta.1 | ✅ Current public beta |
| 0.0.1-internal.∗ | ❌ Superseded by the public beta |
| Stable | Not yet released |
