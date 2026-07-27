import {
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

const MAP_VERSION = 1;

export function loadChannelMappings(
  mappingPath,
  { allowMissing = false } = {},
) {
  let document;
  try {
    document = JSON.parse(readFileSync(mappingPath, "utf8"));
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return [];
    if (error.code === "ENOENT") {
      throw new Error(`Channel mapping file not found: ${mappingPath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(
        `Channel mapping file is not valid JSON: ${mappingPath}`,
      );
    }
    throw error;
  }

  if (document.version !== MAP_VERSION) {
    throw new Error(
      `Channel mapping file version must be ${MAP_VERSION}: ${mappingPath}`,
    );
  }
  if (!Array.isArray(document.channels) || document.channels.length === 0) {
    if (allowMissing && Array.isArray(document.channels)) return [];
    throw new Error(
      `Channel mapping file must contain at least one channel: ${mappingPath}`,
    );
  }

  const mappings = document.channels.map((mapping, index) =>
    validateMapping(mapping, index),
  );
  assertOneToOne(mappings);
  return mappings;
}

export function saveChannelMappings(mappingPath, mappings) {
  const normalized = mappings
    .map((mapping, index) => validateMapping(mapping, index))
    .sort((left, right) =>
      left.slackChannelName.localeCompare(right.slackChannelName),
    );
  assertOneToOne(normalized);

  const document = {
    version: MAP_VERSION,
    channels: normalized,
  };
  const temporaryPath = `${mappingPath}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(document, null, 2)}\n`,
    { mode: 0o600 },
  );
  renameSync(temporaryPath, mappingPath);
}

export function mappingIndex(mappings) {
  return new Map(
    mappings.map((mapping) => [mapping.slackChannelId, mapping]),
  );
}

function validateMapping(mapping, index) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new Error(`Channel mapping at index ${index} must be an object`);
  }
  const slackChannelId = requiredString(
    mapping.slackChannelId,
    `channels[${index}].slackChannelId`,
  );
  const buzzChannelId = requiredString(
    mapping.buzzChannelId,
    `channels[${index}].buzzChannelId`,
  );
  if (!/^[CG][A-Z0-9]+$/.test(slackChannelId)) {
    throw new Error(
      `channels[${index}].slackChannelId must be a Slack public or private channel ID`,
    );
  }
  return {
    slackChannelId,
    slackChannelName: optionalString(mapping.slackChannelName) || slackChannelId,
    buzzChannelId,
    buzzChannelName: optionalString(mapping.buzzChannelName) || buzzChannelId,
  };
}

function assertOneToOne(mappings) {
  const slackIds = new Set();
  const buzzIds = new Set();
  for (const mapping of mappings) {
    if (slackIds.has(mapping.slackChannelId)) {
      throw new Error(
        `Duplicate Slack channel mapping: ${mapping.slackChannelId}`,
      );
    }
    if (buzzIds.has(mapping.buzzChannelId)) {
      throw new Error(
        `Buzz channel is mapped more than once: ${mapping.buzzChannelId}`,
      );
    }
    slackIds.add(mapping.slackChannelId);
    buzzIds.add(mapping.buzzChannelId);
  }
}

function requiredString(value, field) {
  const result = optionalString(value);
  if (!result) throw new Error(`${field} is required`);
  return result;
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}
