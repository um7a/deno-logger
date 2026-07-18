# Logger

`Logger` provides leveled, tagged logging for Deno applications. It writes to
standard error or a file, preserves write order, and supports size- and
age-based file rotation.

## Installation

```sh
deno add jsr:@um7a/logger
```

## Usage

### Logging to standard error

Initialize the logger once, then use the returned instance throughout the
application:

```ts
import { Logger, LogLevel } from "@um7a/logger";

const logger = Logger.initialize({
  logLevel: LogLevel.DEBUG,
});

logger.error("The request failed");
logger.warn("The response was slow");
logger.info("The server started");
logger.debug("The request was accepted");

await logger.flush();
```

By default, messages are written to standard error at `INFO` level. Each line
contains an ISO 8601 timestamp, a padded level name, the message, and an
optional tag:

```text
2026-01-01T00:00:00.000Z INFO  The server started
```

Log writes are queued so calls remain synchronous and messages retain their
order. Call `flush()` before the application exits, or whenever it must wait for
all queued writes to finish.

`Logger.initialize()` can only be called once in a process. Other modules can
retrieve the initialized singleton with `Logger.getInstance()`:

```ts
import { Logger } from "@um7a/logger";

const logger = Logger.getInstance();
logger.info("Using the shared logger");
```

Calling `getInstance()` before initialization, or initializing the logger a
second time, throws an error.

### Filtering by log level

Set `logLevel` to control which messages are emitted:

```ts
const logger = Logger.initialize({
  logLevel: LogLevel.WARN,
});

logger.error("Emitted");
logger.warn("Emitted");
logger.info("Filtered out");
logger.debug("Filtered out");
```

Levels are ordered from least to most verbose:

1. `LogLevel.ERROR`
2. `LogLevel.WARN`
3. `LogLevel.INFO`
4. `LogLevel.DEBUG`

The default level is `LogLevel.INFO`.

### Filtering by tag

Pass a tag as the second argument to any logging method:

```ts
logger.info("Connection opened", "database");
logger.error("Connection failed", "database");
```

Tagged messages include the tag at the end of the line:

```text
2026-01-01T00:00:00.000Z INFO  Connection opened [database]
```

Set `debugTag` to a regular-expression pattern when only matching tags should be
logged:

```ts
const logger = Logger.initialize({
  logLevel: LogLevel.DEBUG,
  debugTag: "^(database|http)$",
});

logger.debug("Query completed", "database"); // Emitted
logger.info("Request completed", "http"); // Emitted
logger.warn("Cache is full", "cache"); // Filtered out
logger.error("Missing tag"); // Filtered out
```

The tag filter applies to every log level. When it is set, messages without a
tag are also filtered out. The default is `null`, which accepts every tag.

### Writing to a file

Set `logFile` to write messages to a file instead of standard error:

```ts
const logger = Logger.initialize({
  logFile: "./logs/application.log",
});

logger.info("The server started");
await logger.flush();
```

The parent directory must already exist. Grant write access when running the
application:

```sh
deno run --allow-write=./logs app.ts
```

`flush()` rejects with an `AggregateError` if one or more queued writes fail.
After reporting those errors, the logger remains available for later writes.

```ts
try {
  await logger.flush();
} catch (error) {
  console.error(error);
}
```

### Rotating log files

File output can be rotated by size, age, or both:

```ts
const logger = Logger.initialize({
  logFile: "./logs/application.log",
  maxFileBytes: 5 * 1024 * 1024,
  maxFileCount: 3,
  rotationDays: 7,
});
```

Before each write, an existing log file is rotated when its size has reached
`maxFileBytes`, or when `rotationDays` has elapsed. Rotated files use numbered
suffixes:

```text
application.log
application.log.1
application.log.2
application.log.3
```

`.1` is the most recently rotated file. Files older than `maxFileCount` are
removed. Set `maxFileCount` to `0` to discard the current file during rotation
without retaining an archived copy.

The defaults are:

- `maxFileBytes`: 10 MiB
- `maxFileCount`: 5
- `rotationDays`: `null` (age-based rotation disabled)

`rotationDays` accepts a positive finite number, including fractional days, or
`null`. Invalid values throw a `RangeError` during initialization or when the
setting is updated.

### Colorizing terminal output

Enable `colorize` to color level names when writing to an interactive terminal:

```ts
const logger = Logger.initialize({
  colorize: true,
});
```

Colors are applied only when output is sent to standard error and standard error
is attached to a terminal. File output never contains ANSI color codes.
Colorization is disabled by default.

### Updating logger settings

Settings can be changed after initialization:

```ts
logger.setLogLevel(LogLevel.DEBUG);
logger.setDebugTag("^worker:");
logger.setLogFile("./logs/worker.log");
logger.setMaxFileBytes(20 * 1024 * 1024);
logger.setMaxFileCount(10);
logger.setRotationDays(1);
logger.setColorize(false);

logger.debug("Job started", "worker:email");
await logger.flush();
```

Use `null` with `setDebugTag()`, `setLogFile()`, or `setRotationDays()` to
disable the corresponding setting.

## License

See [LICENSE](./LICENSE).
