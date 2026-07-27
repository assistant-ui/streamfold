# Security

Streamfold is an experimental parser prototype and has not received a security
audit. Do not treat structural completion as schema validation or authorization
to execute a tool.

Streams default to 16 MiB and nesting depth 128. Pools default to 256 active
streams. Choose lower limits when tool schemas permit them, and continue to
enforce request, transport, schema, and execution limits outside Streamfold.

Please report vulnerabilities privately through GitHub's security advisory
feature for this repository. Avoid opening a public issue until a fix is
available.
