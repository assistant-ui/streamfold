# Security policy

## Supported versions

Security fixes are applied to the latest published version.

## Reporting a vulnerability

Use a [private security advisory](https://github.com/assistant-ui/streamfold/security/advisories/new)
or email [contact@assistant-ui.com](mailto:contact@assistant-ui.com). Do not open
a public issue for an unpatched vulnerability.

Include the affected version, impact, reproduction steps, and any suggested
mitigation. Maintainers will coordinate disclosure after a fix is available.

## Safety boundaries

Streamfold has not received a security audit. Parsed output remains untrusted:
structural completion is not schema validation or permission to execute a tool.

Streams default to 16 MiB, nesting depth 128, and 256 active entries per pool.
Choose lower limits when possible and enforce transport, schema, authorization,
and execution limits outside Streamfold.
