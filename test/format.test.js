import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDeletedMessage,
  formatCopilotMessage,
  formatMirroredMessage,
  neutralizeAtMentions,
  normalizeSlackMessage,
  slackPermalink,
  sourceKey,
} from "../src/format.js";

test("normalizes create, edit, and delete message events", () => {
  const create = normalizeSlackMessage({
    type: "message",
    channel: "C1",
    ts: "100.1",
    text: "hello",
  });
  const edit = normalizeSlackMessage({
    type: "message",
    subtype: "message_changed",
    channel: "C1",
    message: { ts: "100.1", text: "updated" },
  });
  const deletion = normalizeSlackMessage({
    type: "message",
    subtype: "message_deleted",
    channel: "C1",
    deleted_ts: "100.1",
  });

  assert.equal(create.action, "create");
  assert.equal(edit.action, "edit");
  assert.equal(deletion.action, "delete");
});

test("ignores membership messages", () => {
  assert.equal(
    normalizeSlackMessage({
      type: "message",
      subtype: "channel_join",
      channel: "C1",
    }),
    null,
  );
});

test("formats a stable Slack permalink", () => {
  assert.equal(
    slackPermalink("https://demo.slack.com/", "C123", "1722070800.123456"),
    "https://demo.slack.com/archives/C123/p1722070800123456",
  );
});

test("formats mirrored and deleted content", () => {
  const content = formatMirroredMessage({
    adapterLabel: "Slack mirror",
    author: "Ada",
    channelName: "demo",
    message: { ts: "1722070800.123456", text: "Hello Buzz" },
    permalink: "https://demo.slack.com/archives/C1/p1",
  });

  assert.match(content, /Slack mirror · Ada/);
  assert.match(content, /#demo/);
  assert.match(content, /Hello Buzz/);
  assert.match(content, /open in Slack/);
  assert.equal(
    formatDeletedMessage({ content }),
    `${content.split("\n")[0]}\n\n_Deleted in Slack._`,
  );
  assert.equal(sourceKey("C1", "1.2"), "C1:1.2");
});

test("uses file metadata when a Slack message has no text", () => {
  const content = formatMirroredMessage({
    adapterLabel: "Slack mirror",
    author: "Ada",
    channelName: "demo",
    message: {
      ts: "1722070800.123456",
      files: [{ name: "notes.txt", permalink: "https://files.example/notes" }],
    },
  });

  assert.match(content, /\[notes\.txt\]\(https:\/\/files\.example\/notes\)/);
});

test("labels copilot inbox context as personal and non-shareable", () => {
  const content = formatCopilotMessage({
    adapterLabel: "Buzz copilot",
    author: "Ada",
    message: { ts: "1722070800.123456", text: "Private request" },
    permalink: "https://demo.slack.com/archives/D1/p1",
    copilotAgentName: "Ada's Research Copilot",
  });

  assert.match(content, /private copilot inbox/);
  assert.match(content, /@Ada's Research Copilot/);
  assert.match(content, /Private request/);
  assert.match(content, /do not promote into shared findings/);
});

test("neutralizes literal @names so the Buzz CLI never resolves them", () => {
  const zw = "\u200b";
  assert.equal(neutralizeAtMentions("@mully can you look?"), `@${zw}mully can you look?`);
  assert.equal(
    neutralizeAtMentions("ping @mully and\n@ada.l please"),
    `ping @${zw}mully and\n@${zw}ada.l please`,
  );
  assert.equal(neutralizeAtMentions("mail user@example.com"), "mail user@example.com");
  assert.equal(neutralizeAtMentions("<@U0123ABC> hi"), "<@U0123ABC> hi");
  assert.equal(neutralizeAtMentions("hello @ world"), "hello @ world");
  assert.equal(neutralizeAtMentions(""), "");
  assert.equal(neutralizeAtMentions(undefined), undefined);

  const content = formatMirroredMessage({
    adapterLabel: "Slack mirror",
    author: "Ada",
    channelName: "demo",
    message: { ts: "1722070800.123456", text: "@mully see thread" },
  });
  assert.match(content, new RegExp(`@${zw}mully see thread`));
});
