// Builtin modules

// Third party modules
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";

// Local modules
import { Logger, LogLevel } from "../src/logger.ts";

const logger = Logger.initialize();

Deno.test("Logger filters levels and tags for every log level", async () => {
  const directory = await Deno.makeTempDir();
  const logFile = `${directory}/application.log`;

  try {
    logger.setLogFile(logFile);
    logger.setLogLevel(LogLevel.DEBUG);
    logger.setTags(["^allowed$", "^secondary:"]);
    logger.setMaxFileBytes(Number.MAX_SAFE_INTEGER);
    logger.setMaxFileCount(5);
    logger.setRotationDays(null);

    logger.error("allowed error", ["allowed", "error"]);
    logger.warn("allowed warn", ["warn", "allowed"]);
    logger.info("allowed info", ["allowed"]);
    logger.debug("allowed debug", ["allowed"]);
    logger.info("secondary info", ["secondary:http"]);
    logger.error("blocked error", ["blocked"]);
    logger.warn("blocked warn", ["blocked"]);
    logger.info("blocked info", ["blocked"]);
    logger.debug("blocked debug", ["blocked"]);
    logger.info("blocked with empty tags", []);
    logger.info("blocked without tag");

    await logger.flush();
    const output = await Deno.readTextFile(logFile);
    assert(output.includes("ERROR allowed error [allowed] [error]"));
    assert(output.includes("WARN  allowed warn [warn] [allowed]"));
    assert(output.includes("INFO  allowed info [allowed]"));
    assert(output.includes("DEBUG allowed debug [allowed]"));
    assert(output.includes("INFO  secondary info [secondary:http]"));
    assertEquals(output.includes("blocked"), false);

    logger.setTags(null);
    logger.setLogLevel(LogLevel.WARN);
    logger.info("hidden by level");
    logger.warn("visible by level");

    await logger.flush();
    const levelOutput = await Deno.readTextFile(logFile);
    assertEquals(levelOutput.includes("hidden by level"), false);
    assert(levelOutput.includes("visible by level"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Logger rotates a log file after reaching the size limit", async () => {
  const directory = await Deno.makeTempDir();
  const logFile = `${directory}/application.log`;

  try {
    logger.setLogFile(logFile);
    logger.setLogLevel(LogLevel.INFO);
    logger.setTags(null);
    logger.setMaxFileBytes(1);
    logger.setMaxFileCount(2);
    logger.setRotationDays(null);

    logger.info("first message");
    logger.info("second message");

    await logger.flush();
    const currentOutput = await Deno.readTextFile(logFile);
    const rotatedOutput = await Deno.readTextFile(`${logFile}.1`);
    assert(currentOutput.includes("second message"));
    assert(rotatedOutput.includes("first message"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Logger rotates when the configured number of days has elapsed", async () => {
  const directory = await Deno.makeTempDir();
  const logFile = `${directory}/application.log`;

  try {
    logger.setLogFile(logFile);
    logger.setLogLevel(LogLevel.INFO);
    logger.setTags(null);
    logger.setMaxFileBytes(Number.MAX_SAFE_INTEGER);
    logger.setMaxFileCount(2);
    logger.setRotationDays(1 / (24 * 60 * 60 * 100));

    logger.info("first daily message");
    await new Promise((resolve) => setTimeout(resolve, 20));
    logger.info("second daily message");

    await logger.flush();
    const currentOutput = await Deno.readTextFile(logFile);
    const rotatedOutput = await Deno.readTextFile(`${logFile}.1`);
    assert(currentOutput.includes("second daily message"));
    assert(rotatedOutput.includes("first daily message"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Logger rejects invalid rotation day values", () => {
  assertThrows(
    () => logger.setRotationDays(0),
    RangeError,
    "rotationDays must be a positive finite number or null.",
  );
  assertThrows(
    () => logger.setRotationDays(Number.POSITIVE_INFINITY),
    RangeError,
    "rotationDays must be a positive finite number or null.",
  );
});

Deno.test("Logger rejects invalid tag patterns", () => {
  assertThrows(() => logger.setTags(["["]), SyntaxError);
});

Deno.test("Logger flushes queued writes in order and remains reusable", async () => {
  const directory = await Deno.makeTempDir();
  const logFile = `${directory}/application.log`;

  try {
    logger.setLogFile(logFile);
    logger.setLogLevel(LogLevel.INFO);
    logger.setTags(null);
    logger.setMaxFileBytes(Number.MAX_SAFE_INTEGER);
    logger.setMaxFileCount(2);
    logger.setRotationDays(null);

    logger.info("first queued message");
    logger.info("second queued message");
    await logger.flush();

    logger.info("third queued message");
    await logger.flush();

    const output = await Deno.readTextFile(logFile);
    const firstIndex = output.indexOf("first queued message");
    const secondIndex = output.indexOf("second queued message");
    const thirdIndex = output.indexOf("third queued message");
    assert(firstIndex >= 0);
    assert(firstIndex < secondIndex);
    assert(secondIndex < thirdIndex);
  } finally {
    await logger.flush();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Logger reports write errors and continues processing", async () => {
  const directory = await Deno.makeTempDir();
  const logFile = `${directory}/application.log`;

  try {
    logger.setLogFile(`${directory}/missing/application.log`);
    logger.info("failed message");

    await assertRejects(
      () => logger.flush(),
      AggregateError,
      "One or more log writes failed.",
    );

    logger.setLogFile(logFile);
    logger.info("recovered message");
    await logger.flush();

    const output = await Deno.readTextFile(logFile);
    assert(output.includes("recovered message"));
  } finally {
    await logger.flush();
    await Deno.remove(directory, { recursive: true });
  }
});
