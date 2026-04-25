import { basename } from "node:path";

const SECRET_VALUE_PATTERN =
  /\b(?:api[_-]?key|token|secret|password|passwd|authorization)\b\s*[:=]\s*([^\s,;]+)/gi;
const POSIX_ABSOLUTE_PATH_PATTERN = /(?<![\w.-])\/(?:[^\s/]+\/)+[^\s,;)]*/g;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /\b[A-Za-z]:[\\/](?:[^\s\\/]+[\\/])*[^\s,;)]*/g;
const HOME_PATH_PATTERN = /~\/(?:[^\s/]+\/)*[^\s,;)]*/g;

export interface RemoteChannelRedactionOptions {
  verbose?: boolean;
}

export function redactRemoteChannelText(
  input: string,
  options: RemoteChannelRedactionOptions = {},
): string {
  const withoutSecrets = input.replace(
    SECRET_VALUE_PATTERN,
    (match, value: string) => match.replace(value, "[redacted]"),
  );

  if (options.verbose) {
    return withoutSecrets;
  }

  return withoutSecrets
    .replace(HOME_PATH_PATTERN, (value) => basename(value))
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, (value) => basename(value))
    .replace(POSIX_ABSOLUTE_PATH_PATTERN, (value) => basename(value));
}

export function redactRemoteChannelPayload(input: unknown): string {
  if (typeof input === "string") {
    return redactRemoteChannelText(input);
  }

  if (input == null) {
    return "";
  }

  return "[redacted payload]";
}
