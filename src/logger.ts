// Builtin modules

// Third party modules

// Local modules

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export interface LoggerOptions {
  logLevel?: LogLevel;
  tags?: string[] | null;
  logFile?: string | null;
  maxFileBytes?: number;
  maxFileCount?: number;
  rotationDays?: number | null;
  colorize?: boolean;
}

interface LoggerWriteOptions {
  logFile: string | null;
  maxFileBytes: number;
  maxFileCount: number;
  rotationDays: number | null;
}

export class Logger {
  // Private fields
  private static instance: Logger;

  private logLevel: LogLevel;
  private tags: RegExp[] | null;
  private logFile: string | null;
  private maxFileBytes: number;
  private maxFileCount: number;
  private rotationDays: number | null;
  private logFileStartedAt: Map<string, number>;
  private colorize: boolean;
  private writeQueue: Promise<void>;
  private writeErrors: unknown[];

  // Public fields

  // Private methods
  private constructor(options: LoggerOptions = {}) {
    this.logLevel = options.logLevel ?? LogLevel.INFO;
    this.tags = this.compileTags(options.tags ?? null);
    this.logFile = options.logFile ?? null;
    this.maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
    this.maxFileCount = options.maxFileCount ?? 5;
    this.rotationDays = this.validateRotationDays(options.rotationDays ?? null);
    this.logFileStartedAt = new Map();
    this.colorize = options.colorize ?? false;
    this.writeQueue = Promise.resolve();
    this.writeErrors = [];
  }

  private shouldLog(level: LogLevel, tags?: string[]): boolean {
    if (level > this.logLevel) {
      return false;
    }
    const tagPatterns = this.tags;
    if (
      tagPatterns !== null &&
      (!tags ||
        !tags.some((tag) => tagPatterns.some((pattern) => pattern.test(tag))))
    ) {
      return false;
    }
    return true;
  }

  private compileTags(tags: string[] | null): RegExp[] | null {
    return tags?.map((tag) => new RegExp(tag)) ?? null;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    tags?: string[],
  ): string {
    const timestamp = this.formatTimestamp(new Date());
    const levelStr = LogLevel[level];
    const paddedLevel = this.padLevel(levelStr);
    const coloredLevel = this.shouldColorize()
      ? this.colorizeLevel(paddedLevel)
      : paddedLevel;
    const tagStr = tags?.map((tag) => ` [${tag}]`).join("") ?? "";
    return `${timestamp} ${coloredLevel} ${message}${tagStr}\n`;
  }

  private formatTimestamp(date: Date): string {
    const offsetMinutes = -date.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? "+" : "-";
    const absoluteOffsetMinutes = Math.abs(offsetMinutes);
    const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
    const remainingOffsetMinutes = absoluteOffsetMinutes % 60;
    const localDate = new Date(date.getTime() + offsetMinutes * 60 * 1000);
    const localTimestamp = localDate.toISOString().slice(0, -1);

    return `${localTimestamp}${offsetSign}${
      String(offsetHours).padStart(2, "0")
    }:${String(remainingOffsetMinutes).padStart(2, "0")}`;
  }

  private shouldColorize(): boolean {
    return this.colorize && !this.logFile && Deno.stderr.isTerminal();
  }

  private colorizeLevel(levelStr: string): string {
    const colors: Record<string, string> = {
      ERROR: "\x1b[31m",
      WARN: "\x1b[33m",
      INFO: "\x1b[32m",
      DEBUG: "\x1b[35m",
    };
    const reset = "\x1b[0m";
    const trimmed = levelStr.trimEnd();
    const suffix = levelStr.slice(trimmed.length);
    const color = colors[trimmed] || "";
    return color ? `${color}${trimmed}${reset}${suffix}` : levelStr;
  }

  private padLevel(levelStr: string): string {
    const maxLength = 5;
    return levelStr.padEnd(maxLength, " ");
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await Deno.stat(filePath);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }

  private getLogFileStartedAt(
    filePath: string,
    fileInfo: Deno.FileInfo,
  ): number {
    const cachedStartedAt = this.logFileStartedAt.get(filePath);
    if (cachedStartedAt !== undefined) {
      return cachedStartedAt;
    }

    const startedAt = fileInfo.birthtime ?? fileInfo.ctime ?? fileInfo.mtime;
    const startedAtMilliseconds = startedAt?.getTime() ?? Date.now();
    this.logFileStartedAt.set(filePath, startedAtMilliseconds);
    return startedAtMilliseconds;
  }

  private shouldRotateByAge(
    filePath: string,
    fileInfo: Deno.FileInfo,
    rotationDays: number | null,
  ): boolean {
    if (rotationDays === null) {
      return false;
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const rotationInterval = rotationDays * millisecondsPerDay;
    return Date.now() - this.getLogFileStartedAt(filePath, fileInfo) >=
      rotationInterval;
  }

  private async rotateLogFile(options: LoggerWriteOptions): Promise<void> {
    const { logFile, maxFileBytes, maxFileCount, rotationDays } = options;
    if (!logFile || !await this.fileExists(logFile)) {
      return;
    }

    const fileInfo = await Deno.stat(logFile);
    const shouldRotateBySize = fileInfo.size >= maxFileBytes;
    if (
      !shouldRotateBySize &&
      !this.shouldRotateByAge(logFile, fileInfo, rotationDays)
    ) {
      return;
    }

    if (maxFileCount <= 0) {
      await Deno.remove(logFile);
      this.logFileStartedAt.delete(logFile);
      return;
    }

    const oldestPath = `${logFile}.${maxFileCount}`;
    if (await this.fileExists(oldestPath)) {
      await Deno.remove(oldestPath);
    }

    for (let j = maxFileCount - 1; j >= 1; j--) {
      const oldPath = `${logFile}.${j}`;
      const newPath = `${logFile}.${j + 1}`;
      if (await this.fileExists(oldPath)) {
        await Deno.rename(oldPath, newPath);
      }
    }
    await Deno.rename(logFile, `${logFile}.1`);
    this.logFileStartedAt.delete(logFile);
  }

  private async writeLog(
    message: string,
    options: LoggerWriteOptions,
  ): Promise<void> {
    if (options.logFile) {
      await this.rotateLogFile(options);
      const startsNewLogFile = !await this.fileExists(options.logFile);
      await Deno.writeTextFile(options.logFile, message, {
        append: true,
        create: true,
      });
      if (startsNewLogFile) {
        this.logFileStartedAt.set(options.logFile, Date.now());
      }
    } else {
      await Deno.stderr.write(new TextEncoder().encode(message));
    }
  }

  private enqueueLog(message: string): void {
    const options: LoggerWriteOptions = {
      logFile: this.logFile,
      maxFileBytes: this.maxFileBytes,
      maxFileCount: this.maxFileCount,
      rotationDays: this.rotationDays,
    };
    const write = this.writeQueue.then(() => this.writeLog(message, options));
    this.writeQueue = write.catch((error: unknown) => {
      this.writeErrors.push(error);
    });
  }

  private validateRotationDays(days: number | null): number | null {
    if (days !== null && (!Number.isFinite(days) || days <= 0)) {
      throw new RangeError(
        "rotationDays must be a positive finite number or null.",
      );
    }
    return days;
  }

  // Public methods
  public static initialize(options: LoggerOptions = {}): Logger {
    if (Logger.instance) {
      throw new Error("Logger has already been initialized.");
    }
    Logger.instance = new Logger(options);
    return Logger.instance;
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      throw new Error(
        "Logger has not been initialized. Call Logger.initialize(...) first.",
      );
    }
    return Logger.instance;
  }

  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  public setTags(tags: string[] | null): void {
    this.tags = this.compileTags(tags);
  }

  public setLogFile(filePath: string | null): void {
    this.logFile = filePath;
    if (filePath) {
      this.logFileStartedAt.delete(filePath);
    }
  }

  public setMaxFileBytes(bytes: number): void {
    this.maxFileBytes = bytes;
  }

  public setMaxFileCount(count: number): void {
    this.maxFileCount = count;
  }

  public setRotationDays(days: number | null): void {
    this.rotationDays = this.validateRotationDays(days);
  }

  public setColorize(enabled: boolean): void {
    this.colorize = enabled;
  }

  public async flush(): Promise<void> {
    await this.writeQueue;
    if (this.writeErrors.length > 0) {
      const errors = this.writeErrors.splice(0);
      throw new AggregateError(errors, "One or more log writes failed.");
    }
  }

  public error(message: string, tags?: string[]): void {
    if (this.shouldLog(LogLevel.ERROR, tags)) {
      const formatted = this.formatMessage(LogLevel.ERROR, message, tags);
      this.enqueueLog(formatted);
    }
  }

  public warn(message: string, tags?: string[]): void {
    if (this.shouldLog(LogLevel.WARN, tags)) {
      const formatted = this.formatMessage(LogLevel.WARN, message, tags);
      this.enqueueLog(formatted);
    }
  }

  public info(message: string, tags?: string[]): void {
    if (this.shouldLog(LogLevel.INFO, tags)) {
      const formatted = this.formatMessage(LogLevel.INFO, message, tags);
      this.enqueueLog(formatted);
    }
  }

  public debug(message: string, tags?: string[]): void {
    if (this.shouldLog(LogLevel.DEBUG, tags)) {
      const formatted = this.formatMessage(LogLevel.DEBUG, message, tags);
      this.enqueueLog(formatted);
    }
  }
}
