---
"@harnessforce/cli": patch
---

`harnessforce otel-headers` now checks the destination before it prints the Workspace key from the managed settings file, as it already did for the user key. It prints the key only when every destination in its environment (`HARNESSFORCE_ENDPOINT` and the `OTEL_EXPORTER_OTLP_*ENDPOINT` variables) has an origin that the managed settings file itself sets, and otherwise exits with code 4 without falling back to the user key. Before Claude Code v2.1.282, a repository's settings could set an OpenTelemetry endpoint that the managed settings file did not, and the Workspace key was sent there. An organization that sends telemetry to its own collector keeps working when the managed settings file sets that collector's endpoint.
